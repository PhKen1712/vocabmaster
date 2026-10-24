import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { AppText } from './ui';

/**
 * Shown above an answer field in General English: the English description of
 * the meaning/usage, then the Vietnamese one. Both are already sanitised by
 * `bilingualDescription`, so neither contains the answer.
 *
 * The labels are explicit instead of relying on colour or position, which also
 * keeps the block understandable for a screen reader.
 */
export function WordDescription({
  en,
  vi,
  compact = false,
}: {
  en?: string | null;
  vi?: string | null;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  if (!en && !vi) return null;
  return (
    <View style={styles.wrap}>
      {en ? (
        <View style={styles.block}>
          <AppText variant="micro" color={colors.textFaint}>
            ENGLISH DESCRIPTION
          </AppText>
          <AppText variant={compact ? 'caption' : 'body'} color={colors.textMuted}>
            {en}
          </AppText>
        </View>
      ) : null}
      {vi ? (
        <View style={styles.block}>
          <AppText variant="micro" color={colors.textFaint}>
            MÔ TẢ TIẾNG VIỆT
          </AppText>
          <AppText variant={compact ? 'caption' : 'bodyStrong'}>
            {vi}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm, gap: spacing.sm },
  block: { gap: 2 },
});
