import { Redirect } from 'expo-router';
import { useSession } from '@/lib/session';
import { Loading } from '@/ui';

export default function Index() {
  const { ready, user } = useSession();
  if (!ready) return <Loading />;
  return <Redirect href={user ? '/dashboard' : '/login'} />;
}
