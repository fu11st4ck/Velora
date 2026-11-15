import { Injectable } from '@nestjs/common';

/** Injected wherever "now" matters so tests can control time. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
