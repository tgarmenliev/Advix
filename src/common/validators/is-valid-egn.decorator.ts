import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidEgn } from './egn.util';

/**
 * Reusable class-validator декоратор за българско ЕГН —
 * проверява формат, валидна дата на раждане и контролна цифра.
 */
export function IsValidEGN(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidEGN',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a valid Bulgarian EGN`,
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) => isValidEgn(value),
      },
    });
  };
}
