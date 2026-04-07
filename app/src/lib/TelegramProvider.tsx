/**
 * SmartFarmer v3 — Telegram Mini App Provider
 * 
 * Документ: "Telegram Mini Apps (TMA) — наиболее качественное решение
 * для дистрибуции Web3-продуктов в 2025–2026 годах. Фермер открывает
 * чат-бот SmartFarmer, нажимает кнопку 'Открыть Дашборд', и интерфейс
 * разворачивается поверх чата без задержек."
 * 
 * Этот провайдер инициализирует Telegram WebApp SDK,
 * управляет viewport, theme sync и haptic feedback.
 */

import { useEffect, useState, createContext, useContext, type ReactNode, type FC } from 'react';

// ============================================================================
// Типы
// ============================================================================

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface TelegramContextValue {
  isTMA: boolean;
  user: TelegramUser | null;
  colorScheme: 'light' | 'dark';
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  hapticFeedback: (type: 'impact' | 'notification' | 'selection') => void;
  showConfirm: (message: string) => Promise<boolean>;
  showAlert: (message: string) => Promise<void>;
  close: () => void;
}

const TelegramContext = createContext<TelegramContextValue>({
  isTMA: false,
  user: null,
  colorScheme: 'dark',
  viewportHeight: window.innerHeight,
  viewportStableHeight: window.innerHeight,
  isExpanded: false,
  hapticFeedback: () => {},
  showConfirm: async () => false,
  showAlert: async () => {},
  close: () => {},
});

export const useTelegram = () => useContext(TelegramContext);

// ============================================================================
// Provider Component
// ============================================================================

interface TelegramProviderProps {
  children: ReactNode;
}

export const TelegramProvider: FC<TelegramProviderProps> = ({ children }) => {
  const [isTMA, setIsTMA] = useState(false);
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('dark');
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [viewportStableHeight, setViewportStableHeight] = useState(window.innerHeight);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const webApp = (window as any).Telegram?.WebApp;
    
    if (!webApp) {
      console.log('[TMA] Not running inside Telegram — browser mode');
      return;
    }

    console.log('[TMA] Telegram Mini App detected! Initializing...');
    setIsTMA(true);

    // 1. Сообщаем Telegram что приложение готово
    webApp.ready();

    // 2. Разворачиваем на полный экран
    webApp.expand();
    setIsExpanded(true);

    // 3. Настраиваем цветовую тему
    const scheme = webApp.colorScheme || 'dark';
    setColorScheme(scheme);
    
    // Применяем CSS-переменные Telegram к нашему приложению
    if (webApp.themeParams) {
      const root = document.documentElement;
      if (webApp.themeParams.bg_color) {
        root.style.setProperty('--tma-bg-color', webApp.themeParams.bg_color);
      }
      if (webApp.themeParams.text_color) {
        root.style.setProperty('--tma-text-color', webApp.themeParams.text_color);
      }
      if (webApp.themeParams.hint_color) {
        root.style.setProperty('--tma-hint-color', webApp.themeParams.hint_color);
      }
      if (webApp.themeParams.button_color) {
        root.style.setProperty('--tma-button-color', webApp.themeParams.button_color);
      }
    }

    // 4. Получаем данные пользователя
    if (webApp.initDataUnsafe?.user) {
      setUser(webApp.initDataUnsafe.user);
      console.log(`[TMA] User: ${webApp.initDataUnsafe.user.first_name} (@${webApp.initDataUnsafe.user.username || 'N/A'})`);
    }

    // 5. Viewport tracking
    const handleViewportChanged = (event: any) => {
      setViewportHeight(event.viewportHeight || webApp.viewportHeight);
      setViewportStableHeight(event.viewportStableHeight || webApp.viewportStableHeight);
    };

    webApp.onEvent('viewportChanged', handleViewportChanged);
    setViewportHeight(webApp.viewportHeight || window.innerHeight);
    setViewportStableHeight(webApp.viewportStableHeight || window.innerHeight);

    // 6. Theme change tracking
    const handleThemeChanged = () => {
      setColorScheme(webApp.colorScheme || 'dark');
    };
    webApp.onEvent('themeChanged', handleThemeChanged);

    // 7. Включаем closing confirmation для защиты от случайного закрытия
    webApp.enableClosingConfirmation();

    // 8. Устанавливаем header color
    try {
      webApp.setHeaderColor('#0a0f1e');
      webApp.setBackgroundColor('#0a0f1e');
    } catch (e) {
      // Older Telegram versions may not support this
    }

    console.log('[TMA] Initialization complete ✅');

    return () => {
      webApp.offEvent('viewportChanged', handleViewportChanged);
      webApp.offEvent('themeChanged', handleThemeChanged);
    };
  }, []);

  // ============================================================================
  // Haptic Feedback
  // ============================================================================

  const hapticFeedback = (type: 'impact' | 'notification' | 'selection') => {
    const webApp = (window as any).Telegram?.WebApp;
    if (!webApp?.HapticFeedback) return;

    switch (type) {
      case 'impact':
        webApp.HapticFeedback.impactOccurred('medium');
        break;
      case 'notification':
        webApp.HapticFeedback.notificationOccurred('success');
        break;
      case 'selection':
        webApp.HapticFeedback.selectionChanged();
        break;
    }
  };

  // ============================================================================
  // Dialogs
  // ============================================================================

  const showConfirm = (message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const webApp = (window as any).Telegram?.WebApp;
      if (webApp?.showConfirm) {
        webApp.showConfirm(message, resolve);
      } else {
        resolve(window.confirm(message));
      }
    });
  };

  const showAlert = (message: string): Promise<void> => {
    return new Promise((resolve) => {
      const webApp = (window as any).Telegram?.WebApp;
      if (webApp?.showAlert) {
        webApp.showAlert(message, resolve);
      } else {
        window.alert(message);
        resolve();
      }
    });
  };

  const close = () => {
    const webApp = (window as any).Telegram?.WebApp;
    webApp?.close();
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <TelegramContext.Provider
      value={{
        isTMA,
        user,
        colorScheme,
        viewportHeight,
        viewportStableHeight,
        isExpanded,
        hapticFeedback,
        showConfirm,
        showAlert,
        close,
      }}
    >
      {children}
    </TelegramContext.Provider>
  );
};

export default TelegramProvider;
