import * as Joi from 'joi';

/**
 * Валидация на environment променливите при стартиране.
 * При невалидна конфигурация приложението не стартира (abortEarly: false
 * в app.module.ts събира всички грешки в едно ясно съобщение).
 */
export const validationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .required()
    .invalid(Joi.ref('JWT_ACCESS_SECRET'))
    .messages({
      'any.invalid':
        '"JWT_REFRESH_SECRET" must be different from JWT_ACCESS_SECRET',
    }),

  PORT: Joi.number().default(3000),

  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .required(),
});
