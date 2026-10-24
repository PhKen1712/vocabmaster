import React from 'react';
import { StyleSheet } from 'react-native';

import { FadeSlideIn } from './motion';

/**
 * Short cross-screen entrance. It is driven by a route key in App.tsx, so back
 * navigation keeps the previous screen state and only the newly shown screen
 * animates. Reduce Motion turns it into an instant swap.
 */
export function ScreenTransition({ children }: { children: React.ReactNode }) {
  return (
    <FadeSlideIn style={styles.fill} distance={8} duration={190}>
      {children}
    </FadeSlideIn>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
