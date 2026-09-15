import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'jeunes-mims-api', time: new Date().toISOString() };
  }
}
