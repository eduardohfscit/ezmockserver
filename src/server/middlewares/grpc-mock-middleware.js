const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const fs = require('fs');
const session = require('../../shared/session');
const logger = require('../../utils/light-logger');

const loadProtos = (protoDir) => {
  const protos = {};
  const files = fs.readdirSync(protoDir);

  files.forEach((file) => {
    if (file.endsWith('.proto')) {
      const packageDefinition = protoLoader.loadSync(path.join(protoDir, file), {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
      Object.assign(protos, protoDescriptor);
    }
  });

  return protos;
};

const handleGrpcCall = async (call, callback) => {
  if (!session.name) {
    logger.warn('No session started');
    return callback({
      code: grpc.status.UNAVAILABLE,
      message: 'No session started',
    });
  }

  const servicePath = call.call.handler.path;
  const method = servicePath.split('/')[2];

  const sessionDir = path.join(session.sessionsDirectory, session.name);
  const statusFile = path.join(sessionDir, "grpc", `${method}.status`);
  const mockFile = path.join(sessionDir, "grpc", `${method}.content`);

  try {
    if (fs.existsSync(statusFile)) {
      const statusResponse = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      if (statusResponse.code !== 0) {
        return callback({
          code: statusResponse.code,
          message: statusResponse.message,
        });
      }
    }

    const mockResponse = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
    callback(null, mockResponse);
  } catch (error) {
    logger.error(`Mock response not found for method ${method}`);
    callback({
      code: grpc.status.NOT_FOUND,
      message: `Mock response not found for method ${method}`,
    });
  }
};

const grpcMockMiddleware = (protoDir) => {
  const protos = loadProtos(protoDir);

  return (server) => {
    Object.keys(protos).forEach((packageName) => {
      const services = protos[packageName];
      if (!services) {
        logger.warn(`No services found for package ${packageName}`);
        return;
      }

      Object.keys(services).forEach((serviceName) => {
        const service = services[serviceName];
        if (!service || !service.service) {
          logger.warn(`No service definition found for service ${serviceName} in package ${packageName}`);
          return;
        }

        Object.keys(service.service).forEach((methodName) => {
          server.addService(service.service, {
            [methodName]: handleGrpcCall,
          });
        });
      });
    });
  };
};

module.exports = grpcMockMiddleware;