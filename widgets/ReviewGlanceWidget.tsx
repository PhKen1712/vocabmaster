import { HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { GlanceProps } from '../src/widgets/snapshot';

/**
 * Lock Screen accessory widget (circular / rectangular / inline).
 *
 * iOS renders these in "vibrant" monochrome mode, so we deliberately use one
 * foreground colour and no background: the system tints the content.
 */

const ReviewGlanceWidget = (props: GlanceProps, environment: WidgetEnvironment) => {
  'widget';

  const tint = environment.colorScheme === 'dark' ? '#FFFFFF' : '#000000';
  const dim = environment.colorScheme === 'dark' ? '#D6D9E4' : '#3A3F52';
  const family = environment.widgetFamily;
  const goal = `${props.goalDone}/${props.goalTotal}`;

  if (family === 'accessoryInline') {
    return (
      <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(tint)]}>
        {props.dueCount > 0
          ? `${props.dueCount} từ cần ôn · chuỗi ${props.streak}`
          : `Học từ mới · chuỗi ${props.streak}`}
      </Text>
    );
  }

  if (family === 'accessoryCircular') {
    return (
      <VStack spacing={0}>
        <Text modifiers={[font({ size: 24, weight: 'bold' }), foregroundStyle(tint)]}>
          {props.dueCount}
        </Text>
        <Text modifiers={[font({ size: 9, weight: 'semibold' }), foregroundStyle(dim)]}>
          CẦN ÔN
        </Text>
        <Text modifiers={[font({ size: 9 }), foregroundStyle(dim)]}>🔥 {props.streak}</Text>
      </VStack>
    );
  }

  // accessoryRectangular and any fallback
  return (
    <VStack spacing={2}>
      <HStack spacing={4}>
        <Image systemName="book.closed" color={tint} />
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(tint)]}>
          {props.dueCount > 0 ? `${props.dueCount} từ cần ôn hôm nay` : 'Học vài từ mới hôm nay'}
        </Text>
      </HStack>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(dim)]}>
        {props.term} · mục tiêu {goal} · chuỗi {props.streak}
      </Text>
      <Text modifiers={[font({ size: 9 }), foregroundStyle(dim)]}>
        Cập nhật {props.updatedLabel}
      </Text>
    </VStack>
  );
};

export default createWidget<GlanceProps>('ReviewGlanceWidget', ReviewGlanceWidget, {
  term: 'VocabMaster',
  dueCount: 0,
  newCount: 0,
  goalDone: 0,
  goalTotal: 10,
  streak: 0,
  updatedLabel: '--:--',
  isEmpty: true,
});
