import { Alert as NativeAlert, Platform } from 'react-native';

/**
 * Hộp thoại dùng chung cho cả iOS và web.
 *
 * Lý do tồn tại: `Alert` của `react-native-web` là một lớp RỖNG —
 * `Alert.alert()` trên trình duyệt không làm gì cả. Hệ quả thật đã gặp: nút
 * "Đăng xuất" và mọi hộp xác nhận (kể cả xác nhận xoá dữ liệu) im lặng bỏ qua
 * thao tác của người dùng.
 *
 * Trên web, hộp thoại của trình duyệt (`window.confirm` / `window.alert`) là
 * thứ duy nhất chặn được luồng và luôn hiển thị đúng trên mọi kích thước màn
 * hình, nên dùng nó thay vì dựng một modal song song.
 */

export interface AlertButton {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  const list = buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }];

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const body = message ? `${title}\n\n${message}` : title;
    if (list.length === 1) {
      window.alert(body);
      list[0]?.onPress?.();
      return;
    }
    const cancel = list.find((button) => button.style === 'cancel');
    const confirm = list.find((button) => button.style !== 'cancel') ?? list[0];
    if (window.confirm(body)) confirm?.onPress?.();
    else cancel?.onPress?.();
    return;
  }

  NativeAlert.alert(title, message, list);
}

/**
 * Tên `Alert` để các màn hình giữ nguyên `Alert.alert(title, message, buttons)`
 * như trước, chỉ đổi nguồn import.
 */
export const Alert = { alert: showAlert };
