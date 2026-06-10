import { Controller, Get } from '@nestjs/common'

@Controller()
export class AppController {
  @Get()
  root() {
    return {
      name: 'MemBot API',
      version: '0.1.0',
      baseUrl: '/api',
      endpoints: {
        health: '/api/health',
        history: '/api/sessions/history?userId=demo_user_001',
        createSession: 'POST /api/sessions',
      },
      hint: '请通过前端 http://localhost:5173 访问，或调用 /api/* 接口',
    }
  }
}
