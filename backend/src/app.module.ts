import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { PasswordService } from './auth/password.service';
import { TokenService } from './auth/token.service';
import { ProductsController } from './catalog/products.controller';
import { ProductsService } from './catalog/products.service';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { AuthGuard } from './authz/auth.guard';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { Clock } from './common/clock';
import { APP_CONFIG, loadConfig } from './common/config';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { GlobalErrorFilter } from './common/error.filter';
import { HealthController } from './health/health.controller';
import { IdempotencyService } from './idempotency/idempotency.service';
import { MailService } from './mail/mail.service';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, HealthController, ProductsController, InventoryController, CustomersController],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    Clock,
    AuditService,
    MailService,
    TokenService,
    PasswordService,
    AuthService,
    IdempotencyService,
    ProductsService,
    InventoryService,
    CustomersService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: GlobalErrorFilter },
  ],
})
export class AppModule {}
