import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

/**
 * Bố cục theo thiết bị, dựa trên nội dung chứ không dựa vào tên máy.
 *
 * Ngưỡng chọn theo chỗ nội dung bắt đầu khó đọc, không theo kích thước máy phổ
 * biến:
 *   - `phone`   < 700px  : một cột, thanh tab dưới đáy, thao tác bằng ngón tay.
 *   - `tablet`  < 1080px : một cột nhưng rộng hơn, chữ và thẻ thoáng hơn.
 *   - `desktop` >= 1080px: thanh điều hướng bên trái, vùng nội dung giới hạn
 *     bề rộng để mắt không phải quét ngang cả màn hình.
 *
 * Trên iPhone/iPad bản native, bề rộng đo được luôn nằm ở nhóm phone/tablet nên
 * giao diện cũ giữ nguyên; chỉ web mới thật sự chạm tới nhóm desktop.
 */
export type DeviceClass = 'phone' | 'tablet' | 'desktop';

export interface DeviceLayout {
  device: DeviceClass;
  width: number;
  height: number;
  /** Bề rộng tối đa nên dùng cho cột nội dung. */
  contentMaxWidth: number;
  /** Khoảng đệm ngang cho vùng nội dung. */
  gutter: number;
  /** Số cột gợi ý cho lưới/hàng thẻ. */
  columns: number;
  isTouch: boolean;
}

export function useDeviceLayout(): DeviceLayout {
  const dimensions = useWindowDimensions();
  // Trên web, kích thước cửa sổ có thể đổi lúc đang chạy (người dùng kéo rộng
  // cửa sổ, xoay máy tính bảng). Bộ theo dõi của react-native-web không phải lúc
  // nào cũng bắn sự kiện, nên tự lắng nghe để bố cục đổi ngay chứ không phải đợi
  // lần render sau mới đúng.
  const [live, setLive] = useState({ width: dimensions.width, height: dimensions.height });

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      setLive({ width: dimensions.width, height: dimensions.height });
      return;
    }
    const update = () => setLive({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [dimensions.width, dimensions.height]);

  const width = Platform.OS === 'web' ? live.width : dimensions.width;
  const height = Platform.OS === 'web' ? live.height : dimensions.height;

  if (width >= 1080) {
    return {
      device: 'desktop',
      width,
      height,
      contentMaxWidth: 1040,
      gutter: 28,
      columns: 3,
      isTouch: false,
    };
  }

  if (width >= 700) {
    return {
      device: 'tablet',
      width,
      height,
      contentMaxWidth: 760,
      gutter: 22,
      columns: 2,
      isTouch: true,
    };
  }

  return {
    device: 'phone',
    width,
    height,
    contentMaxWidth: 560,
    gutter: 16,
    columns: 1,
    isTouch: true,
  };
}
