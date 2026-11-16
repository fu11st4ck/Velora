import { Body, Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Authenticated, RequirePermission } from '../authz/decorators';
import { Ctx, type RequestContext } from '../common/request-context';
import { IdParam } from '../common/uuid-param';
import { InviteMemberDto, UpdateMemberDto, UpdateOrganizationDto } from './dto';
import { OrganizationService } from './organization.service';

@Controller('organization')
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  /** Everyone sees the business profile; the markup policy is added for managers and owners. */
  @Authenticated()
  @Get()
  get(@Ctx() ctx: RequestContext) {
    return this.organization.get(ctx);
  }

  @RequirePermission('settings.manage')
  @Patch()
  update(@Ctx() ctx: RequestContext, @Body() dto: UpdateOrganizationDto) {
    return this.organization.update(ctx, dto);
  }

  @RequirePermission('team.read')
  @Get('members')
  members(@Ctx() ctx: RequestContext) {
    return this.organization.listMembers(ctx);
  }

  @RequirePermission('team.manage')
  @Post('members')
  invite(@Ctx() ctx: RequestContext, @Body() dto: InviteMemberDto) {
    return this.organization.invite(ctx, dto);
  }

  @RequirePermission('team.manage')
  @Patch('members/:id')
  updateMember(@Ctx() ctx: RequestContext, @IdParam() id: string, @Body() dto: UpdateMemberDto) {
    return this.organization.updateMember(ctx, id, dto);
  }
}

/** The caller's own signed-in devices. */
@Controller('auth/sessions')
export class SessionsController {
  constructor(private readonly organization: OrganizationService) {}

  @Authenticated()
  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.organization.listSessions(ctx);
  }

  @Authenticated()
  @Delete(':id')
  @HttpCode(204)
  async revoke(@Ctx() ctx: RequestContext, @IdParam() id: string): Promise<void> {
    await this.organization.revokeSession(ctx, id);
  }
}
