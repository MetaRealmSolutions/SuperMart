import { Redirect, Slot, usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { NAV } from '@/lib/nav';
import { useSession } from '@/lib/session';
import { Badge, Button, Loading, T, colors } from '@/ui';

export default function AppLayout() {
  const { ready, user, can, hasModule, signOut } = useSession();
  const path = usePathname();
  const router = useRouter();
  const { width } = useWindowDimensions();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  const items = NAV.filter((n) => hasModule(n.module) && can(n.perm));
  const wide = width >= 900;
  const groups = [...new Set(items.map((i) => i.group))];
  const menu = (
    <View
      style={
        wide
          ? { width: 220, backgroundColor: colors.sidebar, paddingVertical: 16 }
          : { backgroundColor: colors.sidebar, flexDirection: 'row', alignItems: 'center' }
      }
    >
      <View style={{ paddingHorizontal: 16, paddingBottom: wide ? 12 : 0 }}>
        <T bold size="lg" color="#fff">
          SuperMart
        </T>
        {wide ? <Badge text="DEMO" tone="demo" /> : null}
      </View>
      <ScrollView
        horizontal={!wide}
        style={{ flex: wide ? undefined : 1 }}
        contentContainerStyle={wide ? undefined : { flexDirection: 'row' }}
      >
        {wide
          ? groups.map((g) => (
              <View key={g} style={{ marginBottom: 8 }}>
                <T size="sm" color="#7fa393" style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
                  {g.toUpperCase()}
                </T>
                {items
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <NavLink key={i.href} {...i} active={path === i.href} go={() => router.push(i.href as any)} />
                  ))}
              </View>
            ))
          : items.map((i) => <NavLink key={i.href} {...i} active={path === i.href} go={() => router.push(i.href as any)} />)}
      </ScrollView>
      <View style={wide ? { padding: 16 } : { padding: 8 }}>
        {wide ? (
          <T size="sm" color={colors.sidebarText}>
            {user.name}
          </T>
        ) : null}
        {wide ? (
          <T size="sm" color="#7fa393">
            {user.role.replace('_', ' ')}
          </T>
        ) : null}
        <Button
          title="Sign out"
          kind="ghost"
          small
          onPress={async () => {
            await signOut();
            router.replace('/login');
          }}
        />
      </View>
    </View>
  );
  return (
    <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
      {menu}
      <View style={{ flex: 1 }}>
        <Slot />
      </View>
    </View>
  );
}

function NavLink({ label, active, go }: { label: string; active: boolean; go: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={go}
      style={{ paddingHorizontal: 16, paddingVertical: 9, backgroundColor: active ? '#1d4a39' : 'transparent' }}
    >
      <T color={active ? '#fff' : colors.sidebarText} bold={active} size="sm">
        {label}
      </T>
    </Pressable>
  );
}
