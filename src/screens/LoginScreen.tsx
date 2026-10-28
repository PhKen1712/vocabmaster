import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Banner, Card, PrimaryButton } from '../components/ui';
import { Input } from '../components/patterns';
import { useAuth } from '../cloud/AuthProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

/**
 * Cửa vào duy nhất của ứng dụng.
 *
 * Ứng dụng bắt buộc đăng nhập: không có nhánh "dùng tiếp không cần tài khoản".
 * Màn hình này thay toàn bộ nội dung khi chưa có phiên hợp lệ, nên không màn
 * hình học nào kịp render trước khi xác thực xong.
 */
export function LoginScreen() {
  const { colors } = useTheme();
  const auth = useAuth();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (!email.trim() || password.length < 6) {
      setNotice('Cần email và mật khẩu từ 6 ký tự trở lên.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      if (mode === 'signIn') {
        await auth.signIn(email, password);
        setPassword('');
      } else {
        const result = await auth.signUp(email, password);
        setPassword('');
        setNotice(
          result.needsEmailConfirm
            ? 'Đã tạo tài khoản. Mở hộp thư để xác nhận email rồi đăng nhập.'
            : 'Đã tạo tài khoản và đăng nhập. Chào mừng bạn!',
        );
        if (!result.needsEmailConfirm) setMode('signIn');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Thử lại giúp mình.');
    } finally {
      setBusy(false);
    }
  };

  if (!auth.available) {
    return (
      <Frame>
        <Card>
          <AppText variant="headline">Chưa cấu hình máy chủ</AppText>
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
            {auth.configHint ??
              'Thiếu EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Ứng dụng chỉ mở được sau khi cấu hình xong.'}
          </AppText>
          <Banner
            tone="warning"
            title="Không có chế độ bỏ qua đăng nhập"
            body="Dữ liệu học phải gắn với một tài khoản để đồng bộ giữa iPhone và máy tính. Vì vậy ứng dụng không mở nội dung khi chưa có máy chủ xác thực."
          />
        </Card>
      </Frame>
    );
  }

  return (
    <Frame>
      <View style={styles.brand}>
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <AppText variant="title" color={colors.onPrimary}>
            VM
          </AppText>
        </View>
        <AppText variant="headline" style={{ marginTop: spacing.md }}>
          VocabMaster
        </AppText>
        <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.xs }}>
          Đăng nhập để học trên mọi thiết bị với cùng một dữ liệu.
        </AppText>
      </View>

      <Card>
        <View style={styles.modeRow}>
          <PrimaryButton
            label="Đăng nhập"
            variant={mode === 'signIn' ? 'primary' : 'secondary'}
            onPress={() => {
              setMode('signIn');
              setNotice(null);
            }}
            style={styles.modeButton}
          />
          <PrimaryButton
            label="Tạo tài khoản"
            variant={mode === 'signUp' ? 'primary' : 'secondary'}
            onPress={() => {
              setMode('signUp');
              setNotice(null);
            }}
            style={styles.modeButton}
          />
        </View>

        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          <AppText variant="caption" color={colors.textMuted}>
            Email
          </AppText>
          <Input
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="ban@example.com"
            onSubmitEditing={() => void submit()}
          />
          <AppText variant="caption" color={colors.textMuted}>
            Mật khẩu
          </AppText>
          <Input
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Ít nhất 6 ký tự"
            onSubmitEditing={() => void submit()}
          />
        </View>

        {notice ? (
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
            {notice}
          </AppText>
        ) : null}
        {auth.error && auth.error !== notice ? (
          <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.sm }}>
            {auth.error}
          </AppText>
        ) : null}

        <PrimaryButton
          label={mode === 'signIn' ? 'Đăng nhập' : 'Tạo tài khoản'}
          loading={busy}
          onPress={() => void submit()}
          style={{ marginTop: spacing.lg }}
        />

        <AppText variant="micro" color={colors.textFaint} style={{ marginTop: spacing.md }}>
          Quên mật khẩu? Mở bảng quản trị trên web để nhận liên kết đặt lại, hoặc nhờ quản trị
          viên đặt lại giúp.
        </AppText>
      </Card>
    </Frame>
  );
}

/**
 * Chặn trường hợp hai tài khoản khác nhau dùng chung một máy.
 *
 * Không tự xoá dữ liệu: người dùng phải đọc rõ hậu quả và xác nhận. Dữ liệu của
 * tài khoản cũ vẫn nằm trên máy chủ của chính tài khoản đó.
 */
export function AccountSwitchScreen({
  ownerEmail,
  email,
  busy,
  onSignOut,
  onConfirm,
}: {
  ownerEmail: string | null;
  email: string | null;
  busy: boolean;
  onSignOut: () => void;
  onConfirm: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Frame>
      <Card>
        <AppText variant="headline">Máy này đang có dữ liệu của tài khoản khác</AppText>
        <AppText variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          {ownerEmail
            ? `Dữ liệu học trên máy thuộc về ${ownerEmail}.`
            : 'Dữ liệu học trên máy thuộc về một tài khoản khác.'}{' '}
          Bạn vừa đăng nhập bằng {email ?? 'một tài khoản khác'}.
        </AppText>
        <Banner
          tone="warning"
          title="Tiếp tục sẽ xoá dữ liệu học trên MÁY NÀY"
          body="Từ vựng, tiến độ, album và lịch sử xu lưu trên máy sẽ bị xoá để nhường chỗ cho tài khoản mới. Dữ liệu của tài khoản cũ vẫn an toàn trên máy chủ của tài khoản đó; đăng nhập lại tài khoản cũ sẽ tải về."
        />
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <PrimaryButton label="Đăng xuất, giữ nguyên máy" variant="secondary" onPress={onSignOut} />
          <PrimaryButton
            label={busy ? 'Đang xoá dữ liệu máy…' : 'Xoá dữ liệu máy và dùng tài khoản này'}
            variant="danger"
            loading={busy}
            onPress={onConfirm}
          />
        </View>
      </Card>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.center}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.column}>{children}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
  },
  column: { width: '100%', maxWidth: 460 },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeRow: { flexDirection: 'row', gap: spacing.sm },
  modeButton: { flex: 1 },
});
