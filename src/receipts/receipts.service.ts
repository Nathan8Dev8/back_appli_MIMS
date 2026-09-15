import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../common/storage/storage.service';

const ASSETS_DIR = join(process.cwd(), 'assets');
const LOGO_PATH = join(ASSETS_DIR, 'logo.png');
const PARTY_EMOJI_PATH = join(ASSETS_DIR, 'emoji-party.png');

const BRAND_BLUE = '#113E7D';
const MIST_BORDER = '#E2E8E8';
const MIST_FILL = '#F0F4F4';
const INK = '#101828';
const INK_MUTED = '#667085';

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Espèces',
  MOBILE_MONEY: 'Mobile Money',
  VIREMENT: 'Virement',
  AUTRE: 'Autre',
};

function buildPdf(params: {
  receiptNo: string;
  memberName: string;
  memberCode: string;
  amount: number;
  method: string;
  paidAt: Date;
  months: string[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const marginX = 42;
    const contentWidth = pageWidth - marginX * 2;

    // Bandeau de marque en haut de page
    doc.rect(0, 0, pageWidth, 8).fill(BRAND_BLUE);

    // Logo Jeunes MIMS, centré en haut du reçu
    let cursorY = 28;
    const logoSize = 50;
    try {
      doc.image(LOGO_PATH, (pageWidth - logoSize) / 2, cursorY, { width: logoSize, height: logoSize });
      cursorY += logoSize + 10;
    } catch {
      cursorY += 6;
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(17)
      .fillColor(BRAND_BLUE)
      .text('JEUNES MIMS', marginX, cursorY, { width: contentWidth, align: 'center' });
    cursorY += 21;

    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(INK_MUTED)
      .text('Reçu officiel de cotisation', marginX, cursorY, { width: contentWidth, align: 'center' });
    cursorY += 24;

    doc
      .moveTo(marginX, cursorY)
      .lineTo(pageWidth - marginX, cursorY)
      .lineWidth(1)
      .strokeColor(MIST_BORDER)
      .stroke();
    cursorY += 20;

    // Reçu N° et date
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(`Reçu N° ${params.receiptNo}`, marginX, cursorY);
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(INK_MUTED)
      .text(
        params.paidAt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }),
        marginX,
        cursorY + 2,
        { width: contentWidth, align: 'right' },
      );
    cursorY += 26;

    // Membre
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK_MUTED).text('MEMBRE', marginX, cursorY, { characterSpacing: 0.5 });
    cursorY += 13;
    doc.font('Helvetica').fontSize(11.5).fillColor(INK).text(params.memberName, marginX, cursorY);
    cursorY += 15;
    doc.font('Helvetica').fontSize(9.5).fillColor(INK_MUTED).text(`Code membre : ${params.memberCode}`, marginX, cursorY);
    cursorY += 22;

    // Motif du versement
    const motif = params.months.length ? `Cotisation mensuelle — ${params.months.join(', ')}` : 'Cotisation mensuelle';
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK_MUTED).text('MOTIF DU VERSEMENT', marginX, cursorY, { characterSpacing: 0.5 });
    cursorY += 13;
    doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(motif, marginX, cursorY, { width: contentWidth });
    cursorY += 18;
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(INK_MUTED)
      .text(`Mode de paiement : ${METHOD_LABELS[params.method] ?? params.method}`, marginX, cursorY);
    cursorY += 28;

    // Bloc montant — mise en avant festive
    const boxHeight = 76;
    doc.roundedRect(marginX, cursorY, contentWidth, boxHeight, 14).fillAndStroke(MIST_FILL, BRAND_BLUE);

    const emojiSize = 34;
    let amountTextX = marginX + 22;
    try {
      doc.image(PARTY_EMOJI_PATH, amountTextX, cursorY + (boxHeight - emojiSize) / 2, { width: emojiSize, height: emojiSize });
      amountTextX += emojiSize + 14;
    } catch {
      // L'illustration est décorative : si l'asset venait à manquer, le texte seul suffit.
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(BRAND_BLUE)
      .text(`${params.amount.toLocaleString('fr-FR')} FCFA payé`, amountTextX, cursorY + boxHeight / 2 - 12, {
        width: pageWidth - marginX - amountTextX,
      });

    cursorY += boxHeight + 28;

    // Mot de remerciement
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(INK_MUTED)
      .text(
        "Ce reçu est généré automatiquement et certifie la réception du versement mentionné ci-dessus. Merci pour ta fidélité et ton engagement au sein de la communauté !",
        marginX,
        cursorY,
        { width: contentWidth, align: 'center' },
      );

    doc.rect(0, doc.page.height - 8, pageWidth, 8).fill(BRAND_BLUE);

    doc.end();
  });
}

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  async generateForPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { member: true, allocations: { include: { due: true } } },
    });

    const count = await this.prisma.receipt.count();
    const receiptNo = `RCPT-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    const months = payment.allocations.map((a) =>
      a.due.dueMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    );

    const pdf = await buildPdf({
      receiptNo,
      memberName: `${payment.member.firstName} ${payment.member.lastName}`,
      memberCode: payment.member.memberCode,
      amount: payment.amount,
      method: payment.method,
      paidAt: payment.paidAt,
      months,
    });

    const key = `receipts/${payment.memberId}/${randomUUID()}.pdf`;
    const { storageKey, sha256 } = await this.storage.put(key, pdf);

    return this.prisma.receipt.create({
      data: { paymentId, receiptNo, storageKey, sha256 },
    });
  }

  async getForDownload(receiptId: string, requester: { memberId: string; roles: string[] }) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: { payment: true },
    });
    if (!receipt) throw new NotFoundException('Reçu introuvable.');

    const privileged = requester.roles.some((r) =>
      ['TRESORIER', 'PRESIDENT_ADMIN', 'SECRETAIRE'].includes(r),
    );
    if (!privileged && receipt.payment.memberId !== requester.memberId) {
      throw new NotFoundException('Reçu introuvable.');
    }

    const buffer = await this.storage.get(receipt.storageKey);
    return { buffer, receipt };
  }

  async listForMember(memberId: string) {
    return this.prisma.receipt.findMany({
      where: { payment: { memberId } },
      include: { payment: true },
      orderBy: { generatedAt: 'desc' },
    });
  }
}
