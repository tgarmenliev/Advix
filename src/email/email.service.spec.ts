import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';

describe('EmailService — безопасен режим', () => {
  const buildService = async (config: Record<string, unknown>) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();
    return moduleRef.get(EmailService);
  };

  afterEach(() => jest.restoreAllMocks());

  it('dry-run по подразбиране → НЕ праща реално', async () => {
    const service = await buildService({
      'email.apiKey': 're_realkey',
      'email.from': 'noreply@advix.bg',
      'email.dryRun': true,
    });
    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await service.send({
      to: 'contact@bank.bg',
      subject: 'Запитване',
      body: 'текст',
    });

    expect(result.dryRun).toBe(true);
    expect(result.delivered).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('placeholder/липсващ ключ → dry-run дори при dryRun=false', async () => {
    const service = await buildService({
      'email.apiKey': 'change-me',
      'email.from': 'noreply@advix.bg',
      'email.dryRun': false,
    });
    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await service.send({
      to: 'contact@bank.bg',
      subject: 'Запитване',
      body: 'текст',
    });

    expect(result.dryRun).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('реален ключ + dryRun=false → вика Resend', async () => {
    const service = await buildService({
      'email.apiKey': 're_realkey',
      'email.from': 'noreply@advix.bg',
      'email.dryRun': false,
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-123' }), { status: 200 }),
    );

    const result = await service.send({
      to: 'contact@bank.bg',
      subject: 'Запитване',
      body: 'текст',
    });

    expect(result).toEqual({ id: 'resend-123', delivered: true, dryRun: false });
  });
});
