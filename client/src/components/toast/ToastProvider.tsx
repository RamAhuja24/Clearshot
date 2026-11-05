import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from '../Icon';
import styles from './Toast.module.css';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

type Notify = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<Notify | null>(null);
const DISMISS_AFTER_MS = 5_000;
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback<Notify>(
    (message, tone = 'info') => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }].slice(-MAX_VISIBLE));
      setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`${styles.toast} ${styles[toast.tone]}`}>
            <Icon name={toastIcon[toast.tone]} size={18} />
            <span className={styles.message}>{toast.message}</span>
            <button
              type="button"
              className={styles.close}
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const toastIcon = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  error: 'alert',
} as const;

export function useToast(): Notify {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error('useToast must be used inside <ToastProvider>');
  return notify;
}
