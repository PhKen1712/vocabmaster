import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

import { AppText, Banner, Screen } from './src/components/ui';
import { ScreenTransition } from './src/components/ScreenTransition';
import { TabBar } from './src/components/TabBar';
import {
  NavigationProvider,
  useNavigation,
  type TabName,
} from './src/navigation/NavigationProvider';
import { AppProvider, useApp } from './src/state/AppProvider';
import { AuthProvider, useAuth } from './src/cloud/AuthProvider';
import { AccountSwitchScreen, LoginScreen } from './src/screens/LoginScreen';
import { readAccountOwner, switchLocalAccountTo, writeAccountOwner, type AccountOwner } from './src/db/account';
import { Alert } from './src/lib/alert';
import { SyncProvider } from './src/sync/SyncProvider';
import { useDeviceLayout } from './src/components/layout';
import { SideNav } from './src/components/SideNav';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { spacing } from './src/theme/tokens';
import { configureNotificationHandler } from './src/notifications/reminders';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { TodayScreen } from './src/screens/TodayScreen';
import { StudyScreen } from './src/screens/StudyScreen';
import { WordsScreen } from './src/screens/WordsScreen';
import { AlbumScreen } from './src/screens/AlbumScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WordDetailScreen } from './src/screens/WordDetailScreen';
import { WordFormScreen } from './src/screens/WordFormScreen';
import { AiStudioScreen } from './src/screens/AiStudioScreen';
import { SessionScreen } from './src/screens/SessionScreen';
import { LearnScreen } from './src/screens/LearnScreen';
import { PlacementScreen } from './src/screens/PlacementScreen';
import { ArcadeScreen } from './src/screens/ArcadeScreen';
import { MusicScreen } from './src/screens/MusicScreen';
import { AsteroidGameScreen } from './src/screens/AsteroidGameScreen';
import { RushGameScreen } from './src/screens/RushGameScreen';
import { MemoryGameScreen } from './src/screens/MemoryGameScreen';
import { MusicProvider, useMusic } from './src/music/MusicProvider';
import { PronunciationScreen } from './src/screens/PronunciationScreen';
import { configureSpeech } from './src/speech/tts';

configureNotificationHandler();

const TAB_NAMES: TabName[] = ['today', 'study', 'arcade', 'words', 'stats', 'settings'];

function isTabRoute(name: string): name is TabName {
  return TAB_NAMES.includes(name as TabName);
}

function Splash() {
  const { colors } = useTheme();
  return (
    <View style={[styles.splash, { backgroundColor: colors.background }]}>
      <View style={[styles.logo, { backgroundColor: colors.primary }]}>
        <AppText variant="title" color={colors.onPrimary}>
          VM
        </AppText>
      </View>
      <AppText variant="headline" style={{ marginTop: spacing.lg }}>
        VocabMaster
      </AppText>
      <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
    </View>
  );
}

function BootError({ message }: { message: string }) {
  return (
    <Screen>
      <Banner
        tone="danger"
        title="Không mở được dữ liệu"
        body="Dữ liệu hiện có không bị xoá. Hãy đóng hẳn ứng dụng rồi mở lại. Nếu lỗi lặp lại, xuất bản sao lưu từ bản cài trước đó và cài lại ứng dụng."
      />
      <Banner tone="warning" title="Chi tiết kỹ thuật" body={message} />
      <AppText variant="caption" color="#8C94AD" style={{ marginTop: spacing.md }}>
        Ghi lại thông báo trên và đưa cho AI tiếp theo trong phiên làm việc mới; checkpoint có
        hướng dẫn vị trí file cơ sở dữ liệu.
      </AppText>
    </Screen>
  );
}

/** Open the word card behind an album notification (tap → detail). */
function NotificationRouter() {
  const { push } = useNavigation();
  const handled = useRef(new Set<string>());

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const identifier = response.notification.request.identifier;
      if (handled.current.has(identifier)) return;
      const data = response.notification.request.content.data as Record<string, unknown> | null;
      if (data?.kind !== 'album' || data?.screen !== 'word') return;
      const id = data?.id;
      if (typeof id !== 'string' || !id) return;
      handled.current.add(identifier);
      push({ name: 'word', id });
    };

    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [push]);

  return null;
}

function RootContent() {
  const { ready, bootError, settings } = useApp();
  const { current, goToTab, stack } = useNavigation();
  const { colors } = useTheme();
  const music = useMusic();
  // Mọi hook phải đứng trước các nhánh return sớm để số lượng hook không đổi giữa các lần render.
  // Bố cục theo thiết bị: điện thoại giữ thanh tab đáy, máy tính bảng nới rộng
  // cột nội dung, máy tính dùng thanh điều hướng bên trái. Xem components/layout.ts.
  const { device } = useDeviceLayout();
  const desktop = Platform.OS === 'web' && device === 'desktop';
  const framed = Platform.OS === 'web' && device === 'tablet';

  // Phím tắt chỉ có trên web: 1–6 chuyển nhanh giữa các mục, giống mọi ứng dụng
  // desktop. Bỏ qua khi con trỏ đang ở ô nhập để không cướp phím gõ văn bản.
  useEffect(() => {
    if (Platform.OS !== 'web' || !desktop || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < TAB_NAMES.length) {
        event.preventDefault();
        goToTab(TAB_NAMES[index]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [desktop, goToTab]);

  if (!ready) return <Splash />;
  if (bootError) return <BootError message={bootError} />;

  if (!settings.onboardingDone && current.name !== 'placement') {
    return <OnboardingScreen />;
  }

  // Máy tính đã có thanh điều hướng bên trái, nên thanh tab đáy chỉ dành cho
  // cảm ứng. Hiện cả hai cùng lúc là hai chỗ điều hướng trùng nhau.
  const showTabBar = !desktop && isTabRoute(current.name) && stack.length === 1;

  let content: React.ReactNode = null;
  switch (current.name) {
    case 'today':
      content = <TodayScreen />;
      break;
    case 'study':
      content = <StudyScreen />;
      break;
    case 'arcade':
      content = <ArcadeScreen />;
      break;
    case 'music':
      content = <MusicScreen />;
      break;
    case 'game':
      content =
        current.game === 'asteroid' ? (
          <AsteroidGameScreen />
        ) : current.game === 'rush' ? (
          <RushGameScreen />
        ) : (
          <MemoryGameScreen />
        );
      break;
    case 'words':
      content = <WordsScreen />;
      break;
    case 'album':
      content = <AlbumScreen />;
      break;
    case 'stats':
      content = <StatsScreen />;
      break;
    case 'settings':
      content = <SettingsScreen />;
      break;
    case 'word':
      content = <WordDetailScreen id={current.id} />;
      break;
    case 'pronunciation':
      content = <PronunciationScreen id={current.wordId} />;
      break;
    case 'wordForm':
      content = <WordFormScreen id={current.id} draft={current.draft} />;
      break;
    case 'ai':
      content = <AiStudioScreen />;
      break;
    case 'session':
      content = <SessionScreen config={current.config} />;
      break;
    case 'learn':
      content = <LearnScreen track={current.track} level={current.level} />;
      break;
    case 'placement':
      content = <PlacementScreen />;
      break;
    default:
      content = <TodayScreen />;
  }

  const app = (
    <KeyboardAvoidingView
      style={[
        styles.flex,
        { backgroundColor: colors.background },
        framed && styles.frame,
        framed && { borderColor: colors.border },
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      onTouchStart={music.beginPlayback}
    >
      <ScreenTransition key={JSON.stringify(current)}>{content}</ScreenTransition>
      {showTabBar ? (
        <TabBar active={current.name as TabName} onChange={(tab) => goToTab(tab)} />
      ) : null}
    </KeyboardAvoidingView>
  );

  // Máy tính: điều hướng dọc luôn hiện, nội dung không kéo rộng hết màn hình.
  if (desktop) {
    return (
      <View style={[styles.flex, styles.desktop, { backgroundColor: colors.background }]}>
        <SideNav active={current.name as TabName} onChange={(tab) => goToTab(tab)} />
        <View style={styles.desktopContent}>{app}</View>
      </View>
    );
  }

  if (!framed) return app;
  return (
    <View style={[styles.flex, styles.stage, { backgroundColor: colors.surfaceAlt }]}>
      {app}
    </View>
  );
}

function ThemedApp() {
  const { settings, db } = useApp();
  const { isDark } = useTheme();
  const auth = useAuth();
  const [owner, setOwner] = useState<AccountOwner | null | undefined>(undefined);
  const [switching, setSwitching] = useState(false);

  // Every screen speaks through the shared module, so one sync keeps the
  // accent and male/female choice consistent everywhere.
  useEffect(() => {
    configureSpeech({ accent: settings.ttsAccent, voice: settings.ttsVoice });
  }, [settings.ttsAccent, settings.ttsVoice]);

  // Đọc chủ sở hữu dữ liệu cục bộ mỗi khi phiên đăng nhập đổi.
  useEffect(() => {
    let cancelled = false;
    if (!db || auth.status !== 'signedIn') {
      setOwner(undefined);
      return;
    }
    readAccountOwner(db)
      .then((value) => {
        if (!cancelled) setOwner(value);
      })
      .catch(() => {
        if (!cancelled) setOwner(null);
      });
    return () => {
      cancelled = true;
    };
  }, [db, auth.status, auth.userId]);

  // Lần đầu đăng nhập trên máy này: nhận dữ liệu đang có làm của tài khoản này.
  // Đây là bước chuyển đổi cho người đã học trước khi ứng dụng bắt buộc đăng
  // nhập — không xoá từ nào.
  useEffect(() => {
    if (!db || auth.status !== 'signedIn' || !auth.userId) return;
    if (owner !== null) return;
    const next = { id: auth.userId, email: auth.email };
    void writeAccountOwner(db, next).then(() => setOwner(next));
  }, [db, auth.status, auth.userId, auth.email, owner]);

  const takeOver = async () => {
    if (!db || !auth.userId) return;
    setSwitching(true);
    try {
      const next = { id: auth.userId, email: auth.email };
      await switchLocalAccountTo(db, next);
      setOwner(next);
    } finally {
      setSwitching(false);
    }
  };

  const confirmTakeOver = () => {
    Alert.alert(
      'Xoá dữ liệu học trên máy này?',
      'Từ vựng, tiến độ, album và lịch sử xu lưu trên máy sẽ bị xoá. Dữ liệu của tài khoản cũ vẫn nằm trên máy chủ của tài khoản đó.',
      [
        { text: 'Huỷ', style: 'cancel' },
        { text: 'Xoá và tiếp tục', style: 'destructive', onPress: () => void takeOver() },
      ],
    );
  };

  let content: React.ReactNode;
  if (!auth.available) {
    content = <LoginScreen />;
  } else if (auth.status === 'checking') {
    content = <Splash />;
  } else if (auth.status !== 'signedIn') {
    // Chưa đăng nhập: không có màn hình nội bộ nào được render.
    content = <LoginScreen />;
  } else if (db && owner === undefined) {
    content = <Splash />;
  } else if (db && owner && owner.id !== auth.userId) {
    content = (
      <AccountSwitchScreen
        ownerEmail={owner.email}
        email={auth.email}
        busy={switching}
        onSignOut={() => void auth.signOut()}
        onConfirm={confirmTakeOver}
      />
    );
  } else {
    content = (
      <NavigationProvider key={auth.userId ?? 'signed-in'}>
        <NotificationRouter />
        <RootContent />
      </NavigationProvider>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {content}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <AuthProvider>
          <SyncProvider>
            <ThemeGate />
          </SyncProvider>
        </AuthProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}

function ThemeGate() {
  const { settings } = useApp();
  return (
    <ThemeProvider mode={settings.themeMode}>
      <MusicProvider>
        <ThemedApp />
      </MusicProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Web màn hình rộng: sân khấu phía sau + khung cột giữ đúng tỉ lệ điện thoại.
  stage: { flex: 1, alignItems: 'center' },
  desktop: { flex: 1, flexDirection: 'row' },
  desktopContent: { flex: 1, alignItems: 'center' },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    overflow: 'hidden',
    shadowColor: '#0B1020',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
  },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
