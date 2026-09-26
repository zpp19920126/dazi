import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      return res.status(status).json({
        code: status,
        message: typeof body === 'string' ? body : body.message ?? '请求失败',
        data: null,
      });
    }
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: 500, message: '服务器内部错误', data: null });
  }
}
