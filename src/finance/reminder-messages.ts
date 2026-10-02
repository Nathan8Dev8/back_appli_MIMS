/** Montant lisible avec des espaces ordinaires. */
const amount = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export const REMINDER_TITLE = 'Rappel de cotisation';

/** Message affiché dans les notifications du membre. */
export function debtReminder(firstName: string, totalDebt: number, monthsLate: number) {
  return (
    `Bonjour ${firstName}, il te reste ${amount(totalDebt)} FCFA de cotisation à régler (${monthsLate} mois). ` +
    `Tu peux passer voir la trésorerie à la prochaine rencontre. Si tu as un souci, écris-nous, on trouvera une solution 🙏`
  );
}
