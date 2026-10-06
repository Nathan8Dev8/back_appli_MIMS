import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { MONTHLY_DUE_AMOUNT, buildCotisationPlan, secondSundayUtc } from './cotisation-allocation';
import { computeCashTotals } from '../finance/cash';
import { resolveOperationDate } from '../finance/operation-date';

const NATURE_NOTIFICATION: Record<string, string> = {
  COTISATION: 'ta cotisation',
  INSCRIPTION: "tes frais d'inscription",
  COLLECTE: 'ta contribution à la collecte',
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly receipts: ReceiptsService,
  ) {}

  async create(dto: CreatePaymentDto, actorId: string) {
    const nature = dto.nature ?? 'COTISATION';
    const paidAt = resolveOperationDate(dto.paidAt, new Date());

    const member = await this.prisma.member.findUnique({ where: { id: dto.memberId } });
    if (!member) throw new NotFoundException('Membre introuvable.');

    let collecteId: string | undefined;
    if (nature === 'COLLECTE') {
      if (!dto.collecteId) throw new BadRequestException('Choisis la collecte concernée.');
      const collecte = await this.prisma.collecte.findUnique({ where: { id: dto.collecteId } });
      if (!collecte) throw new NotFoundException('Collecte introuvable.');
      if (collecte.status !== 'OUVERTE') throw new BadRequestException('Cette collecte est clôturée.');
      collecteId = collecte.id;
    }

    if (nature === 'INSCRIPTION') {
      const existing = await this.prisma.payment.findFirst({
        where: { memberId: dto.memberId, nature: 'INSCRIPTION', amount: { gt: 0 }, status: { in: ['EN_ATTENTE', 'VALIDE'] } },
      });
      if (existing) throw new BadRequestException("Les frais d'inscription de ce membre sont déjà enregistrés.");
    }

    // Refuse d'emblée un montant impossible à répartir, avant de créer quoi que ce soit.
    if (nature === 'COTISATION') await buildCotisationPlan(this.prisma, dto.memberId, dto.amount, paidAt);

    const paymentRef = `PMT-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const payment = await this.prisma.payment.create({
      data: {
        paymentRef,
        memberId: dto.memberId,
        amount: dto.amount,
        method: dto.method,
        note: dto.note,
        nature,
        collecteId,
        paidAt,
        enteredById: actorId,
        status: 'EN_ATTENTE',
      },
    });
    await this.audit.log({
      actorId,
      action: 'CREATE_PAYMENT',
      entityType: 'Payment',
      entityId: payment.id,
      after: payment,
    });
    // Tout encaissement est validé sur-le-champ : le membre reçoit son reçu (avec la nature du versement) automatiquement.
    return this.confirm(payment.id, actorId);
  }

  /**
   * Valide un versement, génère le reçu PDF et notifie le membre. Pour une
   * cotisation, le montant est réparti (mois en cours, puis dettes, puis
   * mois à venir) — voir cotisation-allocation.ts.
   */
  async confirm(paymentId: string, actorId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Paiement introuvable.');
    if (payment.status !== 'EN_ATTENTE') {
      throw new BadRequestException('Ce paiement a déjà été traité.');
    }

    await this.prisma.$transaction(async (tx) => {
      if (payment.nature === 'COTISATION') {
        const steps = await buildCotisationPlan(tx, payment.memberId, payment.amount, payment.paidAt);
        for (const step of steps) {
          let dueId = step.dueId;
          if (step.isNew) {
            const created = await tx.monthlyDue.create({
              data: {
                memberId: payment.memberId,
                dueMonth: step.dueMonth,
                amountDue: MONTHLY_DUE_AMOUNT,
                amountPaid: step.amount,
                balance: step.balanceAfter,
                status: step.balanceAfter <= 0 ? 'PAYE' : 'PARTIEL',
                dueDate: secondSundayUtc(step.dueMonth),
              },
            });
            dueId = created.id;
          } else {
            const due = await tx.monthlyDue.findUniqueOrThrow({ where: { id: dueId! } });
            await tx.monthlyDue.update({
              where: { id: due.id },
              data: {
                amountPaid: due.amountPaid + step.amount,
                balance: step.balanceAfter,
                status: step.balanceAfter <= 0 ? 'PAYE' : 'PARTIEL',
              },
            });
          }
          await tx.paymentAllocation.create({
            data: { paymentId: payment.id, dueId: dueId!, amountAllocated: step.amount },
          });
        }
      }

      await tx.payment.update({ where: { id: payment.id }, data: { status: 'VALIDE' } });
    });

    await this.audit.log({
      actorId,
      action: 'CONFIRM_PAYMENT',
      entityType: 'Payment',
      entityId: payment.id,
      after: { status: 'VALIDE' },
    });

    // L'argent est encaissé quoi qu'il arrive : un reçu raté ne doit pas faire croire à une erreur
    // (sinon le trésorier ressaisit le versement). Il pourra le régénérer depuis Transactions.
    await this.issueReceipt(payment).catch((err) => this.logger.error(`Reçu non généré pour ${payment.paymentRef}`, err));

    return this.prisma.payment.findUnique({
      where: { id: payment.id },
      include: { allocations: { include: { due: true } }, receipt: true },
    });
  }

  /** Génère le reçu PDF et l'envoie au membre (notification). */
  private async issueReceipt(payment: { id: string; memberId: string; nature: string; amount: number }) {
    const receipt = await this.receipts.generateForPayment(payment.id);
    await this.notifications.notifyMember(
      payment.memberId,
      'RECU',
      'Ton reçu est prêt 🧾',
      `Merci pour ${NATURE_NOTIFICATION[payment.nature] ?? 'ton versement'} de ${payment.amount.toLocaleString('fr-FR')} FCFA. Ton reçu ${receipt.receiptNo} est dans ton espace personnel.`,
      '/cotisations',
    );
    return receipt;
  }

  /** Paiement validé resté sans reçu (ex. stockage indisponible au moment de l'encaissement) : on le refait. */
  async regenerateReceipt(paymentId: string, actorId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { receipt: true } });
    if (!payment) throw new NotFoundException('Paiement introuvable.');
    if (payment.status !== 'VALIDE' || payment.amount <= 0) throw new BadRequestException('Seul un encaissement validé a un reçu.');
    if (payment.receipt) throw new BadRequestException('Ce paiement a déjà son reçu.');

    const receipt = await this.issueReceipt(payment);
    await this.audit.log({ actorId, action: 'REGENERATE_RECEIPT', entityType: 'Payment', entityId: payment.id, after: { receiptNo: receipt.receiptNo } });
    return receipt;
  }

  /**
   * Contre-passation : annule l'effet d'un paiement validé en créant un
   * paiement négatif référencé, sans jamais supprimer l'opération d'origine.
   */
  async reverse(paymentId: string, actorId: string, reason: string) {
    const original = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { allocations: true },
    });
    if (!original) throw new NotFoundException('Paiement introuvable.');
    if (original.status !== 'VALIDE' || original.amount <= 0) {
      throw new BadRequestException('Seul un paiement validé peut être annulé.');
    }
    const { balance } = await computeCashTotals(this.prisma);
    if (balance - original.amount < 0) {
      throw new BadRequestException(
        "Annulation impossible : le solde de la caisse deviendrait négatif. Annule d'abord la sortie concernée.",
      );
    }

    const reversal = await this.prisma.$transaction(async (tx) => {
      for (const allocation of original.allocations) {
        const due = await tx.monthlyDue.findUniqueOrThrow({ where: { id: allocation.dueId } });
        const newPaid = due.amountPaid - allocation.amountAllocated;
        const newBalance = due.balance + allocation.amountAllocated;
        await tx.monthlyDue.update({
          where: { id: due.id },
          data: {
            amountPaid: newPaid,
            balance: newBalance,
            status: newBalance >= due.amountDue ? 'A_PAYER' : 'PARTIEL',
          },
        });
      }

      return tx.payment.create({
        data: {
          paymentRef: `RVS-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
          memberId: original.memberId,
          amount: -original.amount,
          method: original.method,
          status: 'VALIDE',
          enteredById: actorId,
          reversalOfId: original.id,
          nature: original.nature,
          collecteId: original.collecteId,
          note: reason,
        },
      });
    });

    await this.prisma.payment.update({ where: { id: original.id }, data: { status: 'ANNULE' } });

    await this.audit.log({
      actorId,
      action: 'REVERSE_PAYMENT',
      entityType: 'Payment',
      entityId: original.id,
      before: { status: 'VALIDE' },
      after: { status: 'ANNULE', reversalId: reversal.id, reason },
    });

    return reversal;
  }

  async listForMember(memberId: string) {
    return this.prisma.payment.findMany({
      where: { memberId },
      include: { allocations: { include: { due: true } }, receipt: true },
      orderBy: { paidAt: 'desc' },
    });
  }

  async listAll() {
    return this.prisma.payment.findMany({
      include: { member: true, receipt: true, collecte: true },
      orderBy: { paidAt: 'desc' },
      take: 200,
    });
  }
}
