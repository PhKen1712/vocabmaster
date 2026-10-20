import { HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { DailyWordProps } from '../src/widgets/snapshot';

/**
 * Home Screen widget (systemSmall / systemMedium / systemLarge).
 *
 * Runs in an isolated runtime: no hooks, no async work, no app state, and no
 * references to module-scope values. Everything it renders comes from props or
 * `environment`. Data is pushed by src/widgets/sync.ts after study activity.
 */

const DailyWordWidget = (props: DailyWordProps, environment: WidgetEnvironment) => {
  'widget';

  const dark = environment.colorScheme === 'dark';
  const title = dark ? '#FFFFFF' : '#141A2E';
  const body = dark ? '#D7DDF2' : '#4B5370';
  const quiet = dark ? '#9AA4C2' : '#7A829E';
  const accent = dark ? '#A6AEFF' : '#4C4EF5';

  const family = environment.widgetFamily;
  const goalText = `${props.goalDone}/${props.goalTotal}`;
  const dueLabel = props.dueCount > 0 ? `${props.dueCount} từ cần ôn` : 'Không còn từ quá hạn';

  if (family === 'systemLarge') {
    return (
      <VStack modifiers={[padding({ all: 16 })]}>
        <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(accent)]}>
          {props.trackLabel.toUpperCase()}
        </Text>
        <Text modifiers={[font({ size: 30, weight: 'bold' }), foregroundStyle(title)]}>
          {props.term}
        </Text>
        {props.ipa ? (
          <Text modifiers={[font({ size: 14 }), foregroundStyle(quiet)]}>{props.ipa}</Text>
        ) : null}
        <Text modifiers={[font({ size: 17 }), foregroundStyle(body)]}>{props.meaningVi}</Text>
        {props.exampleEn ? (
          <Text modifiers={[font({ size: 13 }), foregroundStyle(quiet)]}>{props.exampleEn}</Text>
        ) : null}
        <HStack spacing={16}>
          <VStack>
            <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle(accent)]}>
              {props.dueCount}
            </Text>
            <Text modifiers={[font({ size: 11 }), foregroundStyle(quiet)]}>cần ôn</Text>
          </VStack>
          <VStack>
            <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle(accent)]}>
              {goalText}
            </Text>
            <Text modifiers={[font({ size: 11 }), foregroundStyle(quiet)]}>mục tiêu</Text>
          </VStack>
          <VStack>
            <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle(accent)]}>
              {props.streak}
            </Text>
            <Text modifiers={[font({ size: 11 }), foregroundStyle(quiet)]}>chuỗi ngày</Text>
          </VStack>
        </HStack>
        <Text modifiers={[font({ size: 10 }), foregroundStyle(quiet)]}>
          Cập nhật {props.updatedLabel}
        </Text>
      </VStack>
    );
  }

  if (family === 'systemMedium') {
    return (
      <HStack spacing={14} modifiers={[padding({ all: 14 })]}>
        <VStack>
          <Text modifiers={[font({ size: 10, weight: 'semibold' }), foregroundStyle(accent)]}>
            {props.trackLabel.toUpperCase()}
          </Text>
          <Text modifiers={[font({ size: 24, weight: 'bold' }), foregroundStyle(title)]}>
            {props.term}
          </Text>
          {props.ipa ? (
            <Text modifiers={[font({ size: 12 }), foregroundStyle(quiet)]}>{props.ipa}</Text>
          ) : null}
          <Text modifiers={[font({ size: 14 }), foregroundStyle(body)]}>{props.meaningVi}</Text>
        </VStack>
        <VStack>
          <Text modifiers={[font({ size: 22, weight: 'bold' }), foregroundStyle(accent)]}>
            {props.dueCount}
          </Text>
          <Text modifiers={[font({ size: 10 }), foregroundStyle(quiet)]}>cần ôn</Text>
          <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(body)]}>
            {goalText} mục tiêu
          </Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(quiet)]}>
            Chuỗi {props.streak} ngày
          </Text>
        </VStack>
      </HStack>
    );
  }

  // systemSmall (and any unexpected size): keep the essential three lines.
  return (
    <VStack spacing={4} modifiers={[padding({ all: 12 })]}>
      <Text modifiers={[font({ size: 9, weight: 'semibold' }), foregroundStyle(accent)]}>
        {props.trackLabel.toUpperCase()}
      </Text>
      <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle(title)]}>
        {props.term}
      </Text>
      {props.ipa ? (
        <Text modifiers={[font({ size: 11 }), foregroundStyle(quiet)]}>{props.ipa}</Text>
      ) : null}
      <Text modifiers={[font({ size: 13 }), foregroundStyle(body)]}>{props.meaningVi}</Text>
      <HStack spacing={6}>
        <Image systemName="clock" color={quiet} />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(quiet)]}>{dueLabel}</Text>
      </HStack>
      <Text modifiers={[font({ size: 10 }), foregroundStyle(accent)]}>
        {props.streak} ngày · {goalText}
      </Text>
    </VStack>
  );
};

export default createWidget<DailyWordProps>('DailyWordWidget', DailyWordWidget, {
  term: 'VocabMaster',
  ipa: '',
  meaningVi: 'Mở ứng dụng để bắt đầu học',
  exampleEn: '',
  trackLabel: 'General English',
  dueCount: 0,
  newCount: 0,
  goalDone: 0,
  goalTotal: 10,
  streak: 0,
  updatedLabel: '--:--',
  isEmpty: true,
});
