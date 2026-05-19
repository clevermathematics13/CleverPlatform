import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import DashboardNav from '@/components/DashboardNav';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <DashboardNav userEmail={user.email} userRole={user.role}>
      {children}
    </DashboardNav>
  );
}
