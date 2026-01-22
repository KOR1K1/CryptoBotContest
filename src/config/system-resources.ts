import * as os from 'os';
import * as fs from 'fs';

/**
 * System Resources Detection
 * 
 * Automatically detects available system resources (CPU, RAM)
 * and calculates optimal configuration values
 * 
 * Supports both native systems and Docker containers
 */
export class SystemResources {
  /**
   * Check if running inside Docker container
   */
  static isDockerContainer(): boolean {
    // Check for Docker-specific files
    return (
      fs.existsSync('/.dockerenv') ||
      fs.existsSync('/proc/self/cgroup') &&
      fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker')
    );
  }

  /**
   * Get Docker container memory limit from cgroups (if available)
   * Returns null if not in Docker or limit not set
   */
  static getDockerMemoryLimitGB(): number | null {
    if (!this.isDockerContainer()) {
      return null;
    }

    try {
      // Try cgroup v2 first (newer Docker versions)
      const cgroupV2Path = '/sys/fs/cgroup/memory.max';
      if (fs.existsSync(cgroupV2Path)) {
        const limit = fs.readFileSync(cgroupV2Path, 'utf8').trim();
        if (limit !== 'max' && limit !== '') {
          const limitBytes = parseInt(limit, 10);
          if (!isNaN(limitBytes) && limitBytes > 0) {
            return Math.round((limitBytes / (1024 * 1024 * 1024)) * 100) / 100;
          }
        }
      }

      // Try cgroup v1 (older Docker versions)
      const cgroupV1Path = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
      if (fs.existsSync(cgroupV1Path)) {
        const limit = fs.readFileSync(cgroupV1Path, 'utf8').trim();
        const limitBytes = parseInt(limit, 10);
        // Docker sets a very large number (like 9223372036854771712) if no limit
        // If it's larger than 1TB, assume no limit
        if (!isNaN(limitBytes) && limitBytes > 0 && limitBytes < 1024 * 1024 * 1024 * 1024) {
          return Math.round((limitBytes / (1024 * 1024 * 1024)) * 100) / 100;
        }
      }
    } catch (error) {
      // If we can't read cgroups, fall back to os.totalmem()
    }

    return null;
  }

  /**
   * Get Docker container CPU limit from cgroups (if available)
   * Returns null if not in Docker or limit not set
   */
  static getDockerCPULimit(): number | null {
    if (!this.isDockerContainer()) {
      return null;
    }

    try {
      // Try cgroup v2 first
      const cgroupV2Path = '/sys/fs/cgroup/cpu.max';
      if (fs.existsSync(cgroupV2Path)) {
        const limit = fs.readFileSync(cgroupV2Path, 'utf8').trim();
        if (limit !== 'max' && limit !== '') {
          const [quota, period] = limit.split(' ');
          if (quota && period) {
            const cpuCount = parseInt(quota, 10) / parseInt(period, 10);
            if (!isNaN(cpuCount) && cpuCount > 0) {
              return Math.round(cpuCount * 100) / 100;
            }
          }
        }
      }

      // Try cgroup v1
      const cgroupV1QuotaPath = '/sys/fs/cgroup/cpu/cpu.cfs_quota_us';
      const cgroupV1PeriodPath = '/sys/fs/cgroup/cpu/cpu.cfs_period_us';
      if (fs.existsSync(cgroupV1QuotaPath) && fs.existsSync(cgroupV1PeriodPath)) {
        const quota = parseInt(fs.readFileSync(cgroupV1QuotaPath, 'utf8').trim(), 10);
        const period = parseInt(fs.readFileSync(cgroupV1PeriodPath, 'utf8').trim(), 10);
        // If quota is -1, there's no limit
        if (quota > 0 && period > 0) {
          const cpuCount = quota / period;
          if (!isNaN(cpuCount) && cpuCount > 0) {
            return Math.round(cpuCount * 100) / 100;
          }
        }
      }
    } catch (error) {
      // If we can't read cgroups, fall back to os.cpus().length
    }

    return null;
  }

  /**
   * Get total system RAM in GB
   * In Docker: uses container limit if set, otherwise host RAM
   * Can be overridden via DOCKER_MEMORY_LIMIT_GB environment variable
   */
  static getTotalRAMGB(): number {
    // Check environment variable first (explicit override)
    const envLimit = process.env.DOCKER_MEMORY_LIMIT_GB;
    if (envLimit) {
      const limit = parseFloat(envLimit);
      if (!isNaN(limit) && limit > 0) {
        return limit;
      }
    }

    // Try to get Docker container limit
    const dockerLimit = this.getDockerMemoryLimitGB();
    if (dockerLimit !== null) {
      return dockerLimit;
    }

    // Fall back to host RAM
    const totalBytes = os.totalmem();
    return Math.round((totalBytes / (1024 * 1024 * 1024)) * 100) / 100; // Round to 2 decimals
  }

  /**
   * Get available system RAM in GB (total - free)
   */
  static getAvailableRAMGB(): number {
    const freeBytes = os.freemem();
    return Math.round((freeBytes / (1024 * 1024 * 1024)) * 100) / 100;
  }

  /**
   * Get number of CPU cores
   * In Docker: uses container limit if set, otherwise host CPU count
   * Can be overridden via DOCKER_CPU_LIMIT environment variable
   */
  static getCPUCores(): number {
    // Check environment variable first (explicit override)
    const envLimit = process.env.DOCKER_CPU_LIMIT;
    if (envLimit) {
      const limit = parseFloat(envLimit);
      if (!isNaN(limit) && limit > 0) {
        return Math.ceil(limit); // Round up to nearest integer
      }
    }

    // Try to get Docker container limit
    const dockerLimit = this.getDockerCPULimit();
    if (dockerLimit !== null) {
      return Math.ceil(dockerLimit); // Round up to nearest integer
    }

    // Fall back to host CPU count
    return os.cpus().length;
  }

  /**
   * Calculate optimal MongoDB WiredTiger cache size (GB)
   * 
   * Strategy:
   * - Small systems (<4GB RAM): 1GB cache (25%)
   * - Medium systems (4-16GB RAM): 25-50% of RAM
   * - Large systems (16-64GB RAM): 16-32GB (25-50%)
   * - Very large systems (>64GB RAM): 32GB max (to avoid over-allocation)
   * 
   * Always leaves at least 2GB for OS and other services
   */
  static calculateMongoDBCacheSizeGB(): number {
    const totalRAM = this.getTotalRAMGB();
    
    if (totalRAM < 4) {
      // Very small system: 1GB cache
      return 1;
    } else if (totalRAM < 8) {
      // Small system: 25% of RAM
      return Math.max(1, Math.floor(totalRAM * 0.25));
    } else if (totalRAM < 16) {
      // Medium system: 30% of RAM
      return Math.max(2, Math.floor(totalRAM * 0.30));
    } else if (totalRAM < 32) {
      // Large system: 35% of RAM, max 16GB
      return Math.min(16, Math.max(4, Math.floor(totalRAM * 0.35)));
    } else if (totalRAM < 64) {
      // Very large system: 25-50% of RAM, max 32GB
      return Math.min(32, Math.max(16, Math.floor(totalRAM * 0.40)));
    } else {
      // Extremely large system: Cap at 32GB to avoid over-allocation
      return 32;
    }
  }

  /**
   * Calculate optimal MongoDB connection pool size
   * 
   * Strategy:
   * - Small systems (<4GB RAM, <4 cores): 20-30 connections
   * - Medium systems (4-16GB RAM, 4-8 cores): 50-100 connections
   * - Large systems (16-64GB RAM, 8+ cores): 100-300 connections
   * - Very large systems (>64GB RAM, 12+ cores): 300-500 connections
   * 
   * Formula: basePoolSize = (CPU cores * 10) + (RAM_GB / 2)
   * Then clamp to reasonable limits
   */
  static calculateMongoDBPoolSize(): {
    maxPoolSize: number;
    minPoolSize: number;
  } {
    const totalRAM = this.getTotalRAMGB();
    const cpuCores = this.getCPUCores();

    // Base calculation: CPU cores * 10 + RAM_GB / 2
    let basePoolSize = Math.floor(cpuCores * 10 + totalRAM / 2);

    // Clamp to reasonable limits based on system size
    if (totalRAM < 4 || cpuCores < 4) {
      // Small system
      basePoolSize = Math.min(30, Math.max(20, basePoolSize));
    } else if (totalRAM < 16 || cpuCores < 8) {
      // Medium system
      basePoolSize = Math.min(100, Math.max(50, basePoolSize));
    } else if (totalRAM < 64 || cpuCores < 12) {
      // Large system
      basePoolSize = Math.min(300, Math.max(100, basePoolSize));
    } else {
      // Very large system
      basePoolSize = Math.min(500, Math.max(300, basePoolSize));
    }

    // minPoolSize = 10% of maxPoolSize, minimum 5
    const minPoolSize = Math.max(5, Math.floor(basePoolSize * 0.1));

    return {
      maxPoolSize: basePoolSize,
      minPoolSize,
    };
  }

  /**
   * Get system resource summary for logging
   */
  static getSystemInfo(): {
    totalRAM: number;
    availableRAM: number;
    cpuCores: number;
    mongoDBCache: number;
    mongoDBPool: { max: number; min: number };
    isDocker: boolean;
    dockerMemoryLimit?: number;
    dockerCPULimit?: number;
  } {
    const pool = this.calculateMongoDBPoolSize();
    const isDocker = this.isDockerContainer();
    const dockerMemoryLimit = isDocker ? this.getDockerMemoryLimitGB() : null;
    const dockerCPULimit = isDocker ? this.getDockerCPULimit() : null;

    return {
      totalRAM: this.getTotalRAMGB(),
      availableRAM: this.getAvailableRAMGB(),
      cpuCores: this.getCPUCores(),
      mongoDBCache: this.calculateMongoDBCacheSizeGB(),
      mongoDBPool: {
        max: pool.maxPoolSize,
        min: pool.minPoolSize,
      },
      isDocker,
      dockerMemoryLimit: dockerMemoryLimit || undefined,
      dockerCPULimit: dockerCPULimit || undefined,
    };
  }
}
