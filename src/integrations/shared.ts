export const levelForStatus = (
  status: number
): 'error' | 'info' | 'warn' => {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
};
