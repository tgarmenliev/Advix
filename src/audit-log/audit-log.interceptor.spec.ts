import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AuditLogService } from './audit-log.service';
import { AUDIT_LOG_KEY, AuditLogOptions } from './decorators/audit-log.decorator';

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  const reflector = { get: jest.fn() } as unknown as Reflector;
  const auditLogService = {
    snapshot: jest.fn(),
    record: jest.fn(),
  } as unknown as AuditLogService;

  const makeContext = (
    params: Record<string, string> = {},
    extra: Record<string, unknown> = {},
  ): ExecutionContext =>
    ({
      getType: () => 'http',
      getHandler: () => jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ params, user: undefined, ...extra }),
      }),
    }) as unknown as ExecutionContext;

  const makeHandler = (body: unknown = { id: 'x' }): CallHandler => ({
    handle: () => of(body),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new AuditLogInterceptor(reflector, auditLogService);
  });

  it('маршрут без @AuditLog() метаданни — минава без никакъв DB достъп', async () => {
    (reflector.get as jest.Mock).mockReturnValue(undefined);

    const result$ = await interceptor.intercept(makeContext(), makeHandler());
    await firstValueFrom(result$);

    expect(auditLogService.snapshot).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it("entityIdSource='param' — взима snapshot ПРЕДИ handler-а и записва след успех", async () => {
    const options: AuditLogOptions = {
      action: 'UPDATE' as AuditLogOptions['action'],
      entityType: 'Client',
      entityIdSource: 'param',
    };
    (reflector.get as jest.Mock).mockReturnValue(options);
    (auditLogService.snapshot as jest.Mock).mockResolvedValue({ firstName: 'стар' });
    (auditLogService.record as jest.Mock).mockResolvedValue(undefined);

    const context = makeContext({ id: 'c-1' });
    const result$ = await interceptor.intercept(context, makeHandler({ id: 'c-1' }));
    await firstValueFrom(result$);

    expect(auditLogService.snapshot).toHaveBeenCalledWith('Client', 'c-1');
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        preloadedEntityId: 'c-1',
        oldState: { firstName: 'стар' },
      }),
    );
  });

  it('без entityId, известен предварително — не прави snapshot заявка', async () => {
    const options: AuditLogOptions = {
      action: 'CREATE' as AuditLogOptions['action'],
      entityType: 'Client',
      entityIdSource: 'response',
    };
    (reflector.get as jest.Mock).mockReturnValue(options);

    const result$ = await interceptor.intercept(makeContext(), makeHandler({ id: 'new' }));
    await firstValueFrom(result$);

    expect(auditLogService.snapshot).not.toHaveBeenCalled();
    expect(auditLogService.record).toHaveBeenCalled();
  });

  it("entityIdSource='secureLinkSubject' — извежда entityType/entityId динамично от secureLinkContext", async () => {
    const options: AuditLogOptions = {
      action: 'UPDATE' as AuditLogOptions['action'],
      entityIdSource: 'secureLinkSubject',
    };
    (reflector.get as jest.Mock).mockReturnValue(options);
    (auditLogService.snapshot as jest.Mock).mockResolvedValue({
      firstName: 'стар',
    });
    (auditLogService.record as jest.Mock).mockResolvedValue(undefined);

    const context = makeContext(
      {},
      { secureLinkContext: { id: 'link-1', clientId: 'client-1', familyMemberId: null, loanApplicationId: 'app-1' } },
    );
    const result$ = await interceptor.intercept(context, makeHandler({ id: 'client-1' }));
    await firstValueFrom(result$);

    expect(auditLogService.snapshot).toHaveBeenCalledWith('Client', 'client-1');
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ entityType: 'Client' }),
        preloadedEntityId: 'client-1',
      }),
    );
  });

  it('грешка при record() е best-effort — не чупи отговора към клиента', async () => {
    const options: AuditLogOptions = {
      action: 'UPDATE' as AuditLogOptions['action'],
      entityType: 'Client',
      entityIdSource: 'param',
    };
    (reflector.get as jest.Mock).mockReturnValue(options);
    (auditLogService.snapshot as jest.Mock).mockResolvedValue(null);
    (auditLogService.record as jest.Mock).mockRejectedValue(new Error('db down'));

    const context = makeContext({ id: 'c-1' });
    const result$ = await interceptor.intercept(context, makeHandler({ id: 'c-1' }));
    const response = await firstValueFrom(result$);

    expect(response).toEqual({ id: 'c-1' });
    // record() е fire-and-forget — изчакваме microtask опашката преди да проверим catch-а
    await new Promise(process.nextTick);
  });
});
