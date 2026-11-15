import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  deviceName?: string;
}

export class RefreshTokenDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;

  // Length and strength are enforced by PasswordService so the response carries WEAK_PASSWORD with a rule.
  @IsString()
  @MaxLength(1000)
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MaxLength(1000)
  newPassword!: string;
}
