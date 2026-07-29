export interface AppConfig {
  nodeEnv: string;
  port: number;
  database: {
    url: string;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  storage: {
    accessKey: string;
    secretKey: string;
    bucketName: string;
    region: string;
    endpoint: string;
  };
  email: {
    provider: string;
    apiKey: string;
    from: string;
    // Безопасен режим: НЕ праща реални имейли (само логва). По подразбиране е
    // включен; изключва се само с EMAIL_DRY_RUN=false И реален ключ.
    dryRun: boolean;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL!,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET!,
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    // Access token 1 час, refresh token 30 дни (MASTER_CONTEXT)
    accessExpiresIn: '1h',
    refreshExpiresIn: '30d',
  },
  storage: {
    accessKey: process.env.SCW_ACCESS_KEY ?? '',
    secretKey: process.env.SCW_SECRET_KEY ?? '',
    bucketName: process.env.SCW_BUCKET_NAME ?? '',
    region: process.env.SCW_REGION ?? '',
    endpoint: process.env.SCW_ENDPOINT ?? '',
  },
  email: {
    provider: process.env.EMAIL_PROVIDER ?? 'resend',
    apiKey: process.env.EMAIL_API_KEY ?? '',
    from: process.env.EMAIL_FROM ?? '',
    dryRun: process.env.EMAIL_DRY_RUN !== 'false',
  },
});
