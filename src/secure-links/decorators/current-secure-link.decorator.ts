import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { SecureLinkRequestContext } from '../interfaces/secure-link-context.interface';

/** Извлича закачения от SecureLinkMiddleware линк-контекст — аналог на @CurrentUser(). */
export const CurrentSecureLink = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SecureLinkRequestContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { secureLinkContext: SecureLinkRequestContext }>();
    return request.secureLinkContext;
  },
);
