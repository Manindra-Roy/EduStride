export const getTodayIST = () => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
};

export const getCurrentMonthIST = () => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().substring(0, 7);
};

export const getDisplayName = (user) => {
  if (!user) return 'Teacher';
  return (
    user.studentProfile?.name ||
    (user.role === 'SuperAdmin'
      ? 'Admin'
      : user.email
        ? user.email.split('@')[0]
        : 'Teacher')
  );
};
