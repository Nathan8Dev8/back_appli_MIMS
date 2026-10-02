import { Prisma } from '@prisma/client';

/**
 * Solde de la caisse = entrées validées − sorties validées.
 *
 * Seuls les paiements de montant positif comptent : une contre-passation est
 * tracée par un paiement négatif, mais le paiement d'origine passe alors à
 * ANNULE et sort déjà du total — compter les deux revenait à retirer deux fois.
 */
export async function computeCashTotals(client: Prisma.TransactionClient) {
  const [entries, exits] = await Promise.all([
    client.payment.aggregate({ where: { status: 'VALIDE', amount: { gt: 0 } }, _sum: { amount: true } }),
    client.expense.aggregate({ where: { status: 'VALIDE' }, _sum: { amount: true } }),
  ]);
  const totalEntries = entries._sum.amount ?? 0;
  const totalExits = exits._sum.amount ?? 0;
  return { totalEntries, totalExits, balance: totalEntries - totalExits };
}
