export function formatDate(dateString: string): string {
  const date = new Date(dateString);

  // Get day with ordinal suffix (1st, 2nd, 3rd, etc.)
  const day = date.getDate();
  const suffix = getDaySuffix(day);

  // Format the date
  return date
    .toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    .replace(/\d+/, day + suffix);
}

function getDaySuffix(day: number): string {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}
