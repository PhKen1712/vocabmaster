import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, Divider, PrimaryButton } from '../components/ui';
import { Alert } from '../lib/alert';
import { Input } from '../components/patterns';
import { useAuth } from '../cloud/AuthProvider';
import { useSync } from '../sync/SyncProvider';
import { useApp } from '../state/AppProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

/**
 * Tài khoản và đồng bộ.
 *
 * Điểm quan trọng về trải nghiệm: đăng nhập là TUỲ CHỌN. Không đăng nhập vẫn học
 * đầy đủ, dữ liệu nằm trên máy. Đăng nhập chỉ để cùng một bộ dữ liệu trên nhiều
 * thiết bị — nên phần này không được chặn bất cứ màn hình nào khác.
 */
export function AccountSection() {
  const { colors } = useTheme();
  const { db } = useApp();
  const auth = useAuth();
  const sync = useSync();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (mode: 'signIn' | 'signUp') => {
    if (!email.trim() || password.length < 6) {
      Alert.alert('Thiếu thông tin', 'Cần email và mật khẩu từ 6 ký tự trở lên.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signIn') {
        await auth.signIn(email, password);
        setPassword('');
      } else {
        const result = await auth.signUp(email, password);
        setPassword('');
        Alert.alert(
          result.needsEmailConfirm ? 'Kiểm tra hộp thư' : 'Đã tạo tài khoản',
          result.needsEmailConfirm
            ? 'Máy chủ yêu cầu xác nhận email trước khi đăng nhập.'
            : 'Tài khoản đã sẵn sàng. Dữ liệu trên máy sẽ được gửi lên khi bạn bấm “Gửi dữ liệu máy này lên tài khoản”.',
        );
      }
    } catch (error) {
      Alert.alert('Không đăng nhập được', error instanceof Error ? error.message : 'Thử lại giúp mình.');
    } finally {
      setBusy(false);
    }
  };

  const importLocal = () => {
    Alert.alert(
      'Gửi dữ liệu máy này lên tài khoản?',
      'Toàn bộ từ vựng, tiến độ, album và lịch sử xu trên máy này sẽ được đưa lên tài khoản. Dữ liệu đã có trên tài khoản không bị xoá; máy khác sẽ nhận được phần bổ sung.',
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'Gửi lên',
          onPress: async () => {
            const outcome = await sync.sync({ full: true });
            Alert.alert(
              outcome.ok ? 'Đã gửi' : 'Chưa gửi được',
              outcome.ok
                ? `Đã gửi ${outcome.pushed} mục và nhận ${outcome.pulled} mục từ tài khoản.`
                : (outcome.error ?? 'Thử lại khi có mạng.'),
            );
          },
        },
      ],
    );
  };

  const signOut = () => {
    Alert.alert(
      'Đăng xuất?',
      'Dữ liệu học trên máy này vẫn còn nguyên. Lần sau đăng nhập lại, các thiết bị sẽ tự đồng bộ tiếp.',
      [
        { text: 'Huỷ', style: 'cancel' },
        { text: 'Đăng xuất', style: 'destructive', onPress: () => void auth.signOut() },
      ],
    );
  };

  const statusText = (() => {
    switch (sync.phase) {
      case 'syncing':
        return 'Đang đồng bộ…';
      case 'synced':
        return sync.pending > 0
          ? `Đã gửi — còn ${sync.pending} thay đổi chờ`
          : 'Đã đồng bộ';
      case 'error':
        return sync.message ?? 'Đồng bộ lỗi';
      default:
        return 'Chưa đồng bộ lần nào';
    }
  })();

  if (!auth.available) {
    return (
      <>
        <Card>
          <AppText variant="bodyStrong">Tài khoản & đồng bộ</AppText>
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
            {auth.configHint ??
              'Chưa cấu hình Supabase. Ứng dụng vẫn học bình thường với dữ liệu trên máy.'}
          </AppText>
        </Card>
      </>
    );
  }

  if (auth.status !== 'signedIn') {
    return (
      <Card>
        <AppText variant="bodyStrong">Tài khoản & đồng bộ</AppText>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
          Đăng nhập để dùng cùng một dữ liệu trên điện thoại và máy tính. Không đăng nhập vẫn học
          bình thường, dữ liệu nằm trên máy này.
        </AppText>
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <AppText variant="caption" color={colors.textMuted}>
            Email
          </AppText>
          <Input
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="ban@example.com"
          />
          <AppText variant="caption" color={colors.textMuted}>
            Mật khẩu
          </AppText>
          <Input
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Ít nhất 6 ký tự"
          />
        </View>
        {auth.error ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.sm }}>
            {auth.error}
          </AppText>
        ) : null}
        <View style={styles.row}>
          <PrimaryButton
            label={busy ? 'Đang xử lý…' : 'Đăng nhập'}
            onPress={() => void submit('signIn')}
            disabled={busy}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label="Tạo tài khoản"
            variant="secondary"
            onPress={() => void submit('signUp')}
            disabled={busy}
            style={{ flex: 1 }}
          />
        </View>
        <AppText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.sm }}>
          Quên mật khẩu? Mở bảng quản trị trên web để nhận liên kết đặt lại, hoặc nhờ quản trị viên
          đặt lại cho bạn.
        </AppText>
      </Card>
    );
  }

  return (
    <Card>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">Đang đồng bộ</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {auth.email}
          </AppText>
        </View>
        <View
          style={[
            styles.badge,
            {
              borderColor: sync.phase === 'error' ? colors.danger : colors.success,
              backgroundColor: colors.surfaceAlt,
            },
          ]}
        >
          <AppText
            variant="micro"
            color={sync.phase === 'error' ? colors.danger : colors.success}
          >
            {sync.phase === 'error' ? 'LỖI' : sync.phase === 'syncing' ? 'ĐANG GỬI' : 'ĐÃ NỐI'}
          </AppText>
        </View>
      </View>

      <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
        {statusText}
      </AppText>
      <AppText variant="micro" color={colors.textFaint}>
        Thay đổi được tự động lưu lên máy chủ sau mỗi thao tác — không cần bấm gửi. Mất mạng thì thay
        đổi vẫn nằm trên máy và sẽ tự gửi lại.
      </AppText>

      <Divider />

      <View style={styles.row}>
        <PrimaryButton
          label="Đồng bộ ngay"
          variant="secondary"
          onPress={() => void sync.sync()}
          disabled={sync.phase === 'syncing'}
          style={{ flex: 1 }}
        />
      </View>
      <View style={[styles.row, { marginTop: spacing.sm }]}>
        <PrimaryButton
          label="Gửi dữ liệu máy này lên tài khoản"
          variant="secondary"
          onPress={importLocal}
          disabled={sync.phase === 'syncing' || !db}
          style={{ flex: 1 }}
        />
      </View>
      <Pressable onPress={signOut} accessibilityRole="button" style={{ marginTop: spacing.md }}>
        <AppText variant="caption" color={colors.danger}>
          Đăng xuất
        </AppText>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});
