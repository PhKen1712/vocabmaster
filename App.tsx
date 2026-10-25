import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
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

  if (!ready) return <Splash />;
  if (bootError) return <BootError message={bootError} />;

  if (!settings.onboardingDone && current.name !== 'placement') {
    return <OnboardingScreen />;
  }

  const showTabBar = isTabRoute(current.name) && stack.length === 1;

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

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      onTouchStart={music.beginPlayback}
    >
      <ScreenTransition key={JSON.stringify(current)}>{content}</ScreenTransition>
      {showTabBar ? (
        <TabBar active={current.name as TabName} onChange={(tab) => goToTab(tab)} />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function ThemedApp() {
  const { settings } = useApp();
  const { isDark } = useTheme();

  // Every screen speaks through the shared module, so one sync keeps the
  // accent and male/female choice consistent everywhere.
  useEffect(() => {
    configureSpeech({ accent: settings.ttsAccent, voice: settings.ttsVoice });
  }, [settings.ttsAccent, settings.ttsVoice]);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <NavigationProvider>
        <NotificationRouter />
        <RootContent />
      </NavigationProvider>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <ThemeGate />
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
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
