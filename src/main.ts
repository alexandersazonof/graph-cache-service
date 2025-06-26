import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const corsOrigin = (process.env.CORS_ORIGIN || '*').split(',');

  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: (origin, callback) => {
        if (
          corsOrigin.includes('*') ||
          !origin ||
          corsOrigin.includes(origin)
        ) {
          callback(null, true);
        } else {
          callback(new Error(`CORS policy: ${origin} not allowed`));
        }
      },
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
    },
  });

  await app.listen(process.env.PORT || 3000);
  console.log(`🚀 Server ready at ${process.env.PORT || 3000}`);
}
bootstrap();
