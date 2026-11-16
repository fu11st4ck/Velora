import { Param, ParseUUIDPipe } from '@nestjs/common';
import { Errors } from './errors';

/** A path id that is not a UUID cannot exist, so it answers 404 rather than a validation error. */
export const IdParam = (name = 'id') => Param(name, new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound() }));
