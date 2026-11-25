import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { DomainError, Errors } from '../common/errors';
import { Authenticated, Public } from '../authz/decorators';
import { Client, type ClientInfo, Ctx, type RequestContext } from '../common/request-context';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, RefreshTokenDto, ResetPasswordDto } from './dto';
import { assertFromWebApp, clearRefreshCookie, refreshCookie, setRefreshCookie } from './web-session';

/** Tighter per-IP limit for unauthenticated credential endpoints. The limit value is read at request time. */
const AUTH_LIMIT = {
  rateLimit: {
    max: () => Number(process.env.AUTH_RATE_LIMIT_PER_15_MIN ?? 20),
    timeWindow: '15 minutes',
  },
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

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

  // ───────── Browser sessions: the refresh token travels only in an HttpOnly cookie ─────────

  @Public()
  @RouteConfig(AUTH_LIMIT)
  @Post('web/login')
  @HttpCode(200)
  async webLogin(
    @Body() dto: LoginDto,
    @Client() client: ClientInfo,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    assertFromWebApp(req, this.config);
    const { refreshToken, refreshTokenExpiresAt, ...session } = await this.auth.login(dto.email, dto.password, dto.deviceName, client);
    setRefreshCookie(reply, refreshToken, refreshTokenExpiresAt);
    return { ...session, refreshTokenExpiresAt };
  }

  @Public()
  @Post('web/refresh')
  @HttpCode(200)
  async webRefresh(@Client() client: ClientInfo, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    assertFromWebApp(req, this.config);
    const token = refreshCookie(req);
    if (!token) throw Errors.sessionRevoked();
    try {
      const { refreshToken, refreshTokenExpiresAt, ...pair } = await this.auth.refresh(token, client);
      setRefreshCookie(reply, refreshToken, refreshTokenExpiresAt);
      return { ...pair, refreshTokenExpiresAt };
    } catch (error) {
      // A cookie the server no longer accepts is useless; remove it so the browser stops sending it.
      // Any other failure (database briefly down, timeout) says nothing about the session: keep it.
      if (error instanceof DomainError && error.status === 401) clearRefreshCookie(reply);
      throw error;
    }
  }

  /** Works with an expired access token too: signing out must always be possible. */
  @Public()
  @Post('web/logout')
  @HttpCode(204)
  async webLogout(@Client() client: ClientInfo, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    assertFromWebApp(req, this.config);
    const token = refreshCookie(req);
    if (token) await this.auth.logoutByToken(token, client);
    clearRefreshCookie(reply);
  }
}
