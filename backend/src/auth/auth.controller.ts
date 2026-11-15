import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { Authenticated, Public } from '../authz/decorators';
import { Client, type ClientInfo, Ctx, type RequestContext } from '../common/request-context';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshTokenDto, ResetPasswordDto } from './dto';

/** Tighter per-IP limit for unauthenticated credential endpoints. The limit value is read at request time. */
const AUTH_LIMIT = {
  rateLimit: {
    max: () => Number(process.env.AUTH_RATE_LIMIT_PER_15_MIN ?? 20),
    timeWindow: '15 minutes',
  },
};

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RouteConfig(AUTH_LIMIT)
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Client() client: ClientInfo) {
    return this.auth.login(dto.email, dto.password, dto.deviceName, client);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto, @Client() client: ClientInfo) {
    return this.auth.refresh(dto.refreshToken, client);
  }

  @Authenticated()
  @Post('logout')
  @HttpCode(204)
  async logout(@Ctx() ctx: RequestContext, @Body() dto: RefreshTokenDto): Promise<void> {
    await this.auth.logout(ctx, dto.refreshToken);
  }

  @Public()
  @RouteConfig(AUTH_LIMIT)
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Client() client: ClientInfo) {
    await this.auth.forgotPassword(dto.email, client);
    return { accepted: true };
  }

  @Public()
  @RouteConfig(AUTH_LIMIT)
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() dto: ResetPasswordDto, @Client() client: ClientInfo): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.newPassword, client);
  }

  @Authenticated()
  @Post('change-password')
  @HttpCode(204)
  async changePassword(@Ctx() ctx: RequestContext, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(ctx, dto.currentPassword, dto.newPassword);
  }

  @Authenticated()
  @Get('me')
  me(@Ctx() ctx: RequestContext) {
    return this.auth.me(ctx);
  }
}
