import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Маркира endpoint като публичен — JwtAuthGuard го пропуска. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
