import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { resolveSlotClass } from '../utils/slotStyles';

export interface SaveButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  unstyled?: boolean;
  children: ReactNode;
}

export function SaveButton({
  icon,
  unstyled = false,
  children,
  className = '',
  type = 'button',
  ...rest
}: SaveButtonProps) {
  return (
    <button
      type={type}
      className={resolveSlotClass('iuk-save-button', unstyled, className)}
      {...rest}
    >
      {icon && (
        <span className={resolveSlotClass('iuk-save-button__icon', unstyled)}>
          {icon}
        </span>
      )}
      <span>{children}</span>
    </button>
  );
}

export default SaveButton;
