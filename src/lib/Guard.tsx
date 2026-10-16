import React from 'react';
import { View } from 'react-native';
import { useSession } from './session';
import { Empty } from '@/ui';

/** Route-level guard. The server independently enforces the same module + permission rules. */
export function Guard({ module = 'core', perm, children }: { module?: string; perm: string; children: React.ReactNode }) {
  const { hasModule, can } = useSession();
  if (!hasModule(module))
    return (
      <View style={{ flex: 1 }}>
        <Empty title="Module not enabled" hint={`The "${module}" module is not part of this installation's edition.`} />
      </View>
    );
  if (!can(perm))
    return (
      <View style={{ flex: 1 }}>
        <Empty title="Access denied" hint="Your role does not include this permission." />
      </View>
    );
  return <>{children}</>;
}
