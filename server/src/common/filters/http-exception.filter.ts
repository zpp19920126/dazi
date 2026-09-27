import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      // class-validator 校验失败时 body.message 是 string[]，归一化为分号拼接的字符串，保证前端提示可读
      const message =
        typeof body === 'string'
          ? body
          : Array.isArray(body.message)
            ? body.message.join('；')
            : body.message ?? '请求失败';
      return res.status(status).json({ code: status, message, data: null });
    }
    // 未知异常必须记录堆栈，否则线上 500 无法排障
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ code: 500, message: '服务器内部错误', data: null });
  }
}
