import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly receipts: ReceiptsService,
  ) {}

  async create(dto: CreatePaymentDto, actorId: string) {
    const paymentRef = `PMT-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const payment = await this.prisma.payment.create({
      data: {
        paymentRef,
        memberId: dto.memberId,
        amount: dto.amount,
        method: dto.method,
        note: dto.note,
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
    return payment;
  }

  /**
   * Valide un versement : l'affecte aux échéances les plus anciennes en
   * premier (FIFO), recalcule les soldes, génère le reçu PDF et notifie
   * le membre — cf. cahier des charges §7 « Stratégie de dette ».
   */
  async confirm(paymentId: string, actorId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Paiement introuvable.');
    if (payment.status !== 'EN_ATTENTE') {
      throw new BadRequestException('Ce paiement a déjà été traité.');
    }

    await this.prisma.$transaction(async (tx) => {
      let remaining = payment.amount;
      const openDues = await tx.monthlyDue.findMany({
        where: { memberId: payment.memberId, status: { in: ['A_PAYER', 'PARTIEL'] } },
        orderBy: { dueMonth: 'asc' },
      });

      for (const due of openDues) {
        if (remaining <= 0) break;
        const toAllocate = Math.min(remaining, due.balance);
        if (toAllocate <= 0) continue;

        await tx.paymentAllocation.create({
          data: { paymentId: payment.id, dueId: due.id, amountAllocated: toAllocate },
        });

        const newPaid = due.amountPaid + toAllocate;
        const newBalance = due.balance - toAllocate;
        await tx.monthlyDue.update({
          where: { id: due.id },
          data: {
            amountPaid: newPaid,
            balance: newBalance,
            status: newBalance <= 0 ? 'PAYE' : 'PARTIEL',
          },
        });
        remaining -= toAllocate;
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

    const receipt = await this.receipts.generateForPayment(payment.id);

    await this.notifications.notifyMember(
      payment.memberId,
      'RECU',
      'Votre reçu est disponible',
      `Merci pour votre versement de ${payment.amount.toLocaleString('fr-FR')} FCFA. Votre reçu ${receipt.receiptNo} est prêt dans votre espace personnel.`,
    );

    return this.prisma.payment.findUnique({
      where: { id: payment.id },
      include: { allocations: { include: { due: true } }, receipt: true },
    });
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
    if (original.status !== 'VALIDE') {
      throw new BadRequestException('Seul un paiement validé peut être contre-passé.');
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
      include: { member: true, receipt: true },
      orderBy: { paidAt: 'desc' },
      take: 200,
    });
  }
}
