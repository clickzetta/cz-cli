/**
 * Core Parser - Parses plan.json and job_profile.json data
 */
import { logger } from '../../logger.js';

export interface ParsedData {
  sqlInfo: SqlInfo;
  versionInfo: { gitBranch: string };
  vcMode: VcMode;
  settings: Record<string, string>;
  planStages: Record<string, any>;
  profileStages: Record<string, any>;
  hasProfile: boolean;
  hasPlan: boolean;
  rawProfile: Record<string, any>;
}

export interface SqlInfo {
  text: string;
  isRefresh: boolean;
  isCompaction: boolean;
  sqlSubtype: string;
  refreshTarget: string;
  sqlTypeDisplay: string;
}

export interface VcMode {
  isAp: boolean;
  mode: string;
  vcCores: number;
}

export interface ProfilingPhase {
  name: string;
  description: string;
  durationMs: number;
  durationSec: number;
  percentage: number;
  startEvent: number;
  endEvent: number;
}

export interface JobProfilingResult {
  profilingMap: Record<number, number>;
  durations: Record<string, number>;
  phases: ProfilingPhase[];
  bottleneck: ProfilingPhase | null;
  totalTimeMs: number;
  totalTimeSec: number;
}

export class PlanProfileParser {
  plan: Record<string, any> = {};
  hasPlan = false;
  profile: Record<string, any> = {};
  rawProfile: Record<string, any> = {};
  hasProfile = false;
  private _parsedData: ParsedData | null = null;

  constructor(planData: Record<string, any> | null, profileData: Record<string, any> | null) {
    if (planData && Object.keys(planData).length) {
      this.plan = planData;
      const hasStages = 'dml' in this.plan && 'stages' in (this.plan.dml || {});
      const hasSettings = 'settings' in this.plan && this.plan.settings;
      if (hasStages || hasSettings) this.hasPlan = true;
    }

    if (profileData && Object.keys(profileData).length) {
      if ('data' in profileData) {
        this.rawProfile = profileData.data || {};
        this.profile = this.rawProfile.jobSummary || {};
      } else {
        this.profile = profileData.jobSummary || profileData;
        this.rawProfile = profileData;
      }
      const hasStageData = this.profile && 'stageSummary' in this.profile && this.profile.stageSummary;
      const hasErrorData = this.rawProfile && 'jobStatus' in this.rawProfile && this.rawProfile.jobStatus?.message;
      const hasProfilingData = (
        (this.profile && this.profile.jobProfiling?.profiling) ||
        (this.rawProfile && this.rawProfile.jobStatus?.jobProfiling?.profiling)
      );
      if (hasStageData || hasErrorData || hasProfilingData) this.hasProfile = true;
    }
  }

  parse(): ParsedData {
    if (this._parsedData) return this._parsedData;

    let settings: Record<string, string> = {};
    let sqlText = '';
    let gitBranch = 'Unknown';

    if (this.hasPlan) {
      settings = { ...(this.plan.settings || {}) };
      sqlText = settings['cz.sql.text'] || '';
      const buildInfoStr = settings['build_info'] || '';
      if (buildInfoStr && typeof buildInfoStr === 'string') {
        for (const part of buildInfoStr.split(',')) {
          if (part.includes('GitBranch:')) {
            gitBranch = part.split('GitBranch:')[1].trim();
            break;
          }
        }
      }
      if (gitBranch === 'Unknown') {
        const buildInfoDict = this.plan.build_info;
        if (buildInfoDict && typeof buildInfoDict === 'object') {
          gitBranch = buildInfoDict.GitBranch || 'Unknown';
        }
      }
    }

    if (!sqlText && this.rawProfile) {
      const jobDesc = this.rawProfile.jobDesc || {};
      const sqlJob = jobDesc.sqlJob || {};
      const queryList: string[] = sqlJob.query || [];
      if (queryList.length) sqlText = queryList.join(' ');
      if (!Object.keys(settings).length) {
        const hint = sqlJob.sqlConfig?.hint || {};
        if (Object.keys(hint).length) settings = { ...hint };
      }
    }

    const isRefresh = sqlText ? sqlText.toUpperCase().includes('REFRESH') : false;
    const isCompaction = sqlText ? (sqlText.toUpperCase().includes('COMPACTION') || sqlText.toUpperCase().includes('OPTIMIZE')) : false;
    const sqlSubtype = this.detectSqlSubtype(sqlText);
    const refreshTarget = PlanProfileParser.extractRefreshTarget(sqlText);

    let sqlTypeDisplay: string;
    if (isRefresh) {
      sqlTypeDisplay = 'REFRESH';
      if (refreshTarget) sqlTypeDisplay += ` (${refreshTarget})`;
    } else if (sqlText) {
      sqlTypeDisplay = `REGULAR (${sqlSubtype})`;
    } else {
      sqlTypeDisplay = 'Unknown';
    }

    this._parsedData = {
      sqlInfo: { text: sqlText, isRefresh, isCompaction, sqlSubtype, refreshTarget, sqlTypeDisplay },
      versionInfo: { gitBranch },
      vcMode: {
        isAp: (settings['cz.inner.is.ap.vc'] || '0') === '1',
        mode: (settings['cz.inner.is.ap.vc'] || '0') === '1' ? 'AP' : 'GP',
        vcCores: PlanProfileParser.getVcCores(settings),
      },
      settings,
      planStages: this.parsePlanStages(),
      profileStages: this.parseProfileStages(),
      hasProfile: this.hasProfile,
      hasPlan: this.hasPlan,
      rawProfile: this.rawProfile,
    };
    return this._parsedData;
  }

  private parsePlanStages(): Record<string, any> {
    const stages: Record<string, any> = {};
    if (this.plan.dml?.stages) {
      for (const stage of this.plan.dml.stages) {
        const stageId = stage.id || stage.stageId;
        if (stageId) stages[stageId] = stage;
      }
    }
    return stages;
  }

  private detectSqlSubtype(sqlText: string): string {
    if (!sqlText) return 'UNKNOWN';
    let sqlUpper = sqlText.toUpperCase();
    const lines = sqlUpper.split('\n').map(line => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.substring(0, idx).trim() : line.trim();
    });
    let sqlClean = lines.join(' ');
    while (sqlClean.includes('/*') && sqlClean.includes('*/')) {
      const start = sqlClean.indexOf('/*');
      const end = sqlClean.indexOf('*/');
      sqlClean = sqlClean.substring(0, start) + ' ' + sqlClean.substring(end + 2);
    }
    sqlClean = sqlClean.replace(/\s+/g, ' ').trim();
    if (sqlClean.startsWith('MERGE INTO') || sqlClean.startsWith('MERGE\nINTO')) return 'MERGE INTO';
    if (sqlClean.startsWith('COPY INTO') || sqlClean.startsWith('COPY\nINTO')) return 'COPY INTO';
    if (sqlClean.startsWith('INSERT')) return 'INSERT';
    if (sqlClean.startsWith('UPDATE')) return 'UPDATE';
    if (sqlClean.startsWith('DELETE')) return 'DELETE';
    if (sqlClean.startsWith('SELECT') || sqlClean.startsWith('WITH')) return 'SELECT';
    if (sqlClean.startsWith('CREATE')) return 'CREATE';
    if (sqlClean.startsWith('DROP')) return 'DROP';
    if (sqlClean.startsWith('ALTER')) return 'ALTER';
    if (sqlClean.startsWith('TRUNCATE')) return 'TRUNCATE';
    if (sqlClean.startsWith('REFRESH')) return 'REFRESH';
    if (sqlClean.includes('COMPACTION') || sqlClean.includes('OPTIMIZE')) return 'COMPACTION';
    return 'UNKNOWN';
  }

  static extractRefreshTarget(sqlText: string): string {
    if (!sqlText) return '';
    const m = sqlText.match(/REFRESH\s+(?:DYNAMIC\s+TABLE|MATERIALIZED\s+VIEW)\s+([\w.]+)/i);
    return m ? m[1] : '';
  }

  private parseProfileStages(): Record<string, any> {
    const stages: Record<string, any> = {};
    if (this.profile?.stageSummary) {
      for (const [stageId, stageData] of Object.entries(this.profile.stageSummary)) {
        stages[stageId] = stageData;
      }
    }
    return stages;
  }

  getJobProfilingAnalysis(): JobProfilingResult | null {
    if (!this._parsedData) this.parse();
    return this.parseJobProfiling();
  }

  private parseJobProfiling(): JobProfilingResult | null {
    if (!this.hasProfile) return null;
    let profilingData: any[] = [];
    if (this.profile?.jobProfiling) profilingData = this.profile.jobProfiling.profiling || [];
    if (!profilingData.length && this.rawProfile?.jobStatus?.jobProfiling) {
      profilingData = this.rawProfile.jobStatus.jobProfiling.profiling || [];
    }
    if (!profilingData.length) return null;

    const profilingMap: Record<number, number> = {};
    for (const entry of profilingData) {
      profilingMap[parseInt(entry.e)] = parseInt(entry.t);
    }

    const durations: Record<string, number> = {};
    if (profilingMap[100] !== undefined && profilingMap[108] !== undefined) durations.setup = profilingMap[108] - profilingMap[100];
    if (profilingMap[110] !== undefined && profilingMap[112] !== undefined) durations.resumingCluster = profilingMap[112] - profilingMap[110];
    if (profilingMap[112] !== undefined && profilingMap[120] !== undefined) durations.queued = profilingMap[120] - profilingMap[112];
    if (profilingMap[120] !== undefined && profilingMap[130] !== undefined) durations.running = profilingMap[130] - profilingMap[120];
    if (profilingMap[130] !== undefined && profilingMap[150] !== undefined) durations.finish = profilingMap[150] - profilingMap[130];
    if (profilingMap[160] !== undefined && profilingMap[165] !== undefined) durations.persistence = profilingMap[165] - profilingMap[160];
    if (profilingMap[100] !== undefined) {
      const endId = profilingMap[170] !== undefined ? 170 : 155;
      if (profilingMap[endId] !== undefined) durations.total = profilingMap[endId] - profilingMap[100];
    }

    const totalTime = durations.total || 0;
    const phaseInfo: [string, string, number, number, string][] = [
      ['Setup', 'setup', 100, 108, 'SQL初始化（编译优化）'],
      ['Resuming Cluster', 'resumingCluster', 110, 112, '启动VC'],
      ['Queued', 'queued', 112, 120, '等待资源'],
      ['Running', 'running', 120, 130, 'SQL处理数据'],
      ['Finish', 'finish', 130, 150, 'SQL结束（commit等）'],
    ];

    const phases: ProfilingPhase[] = [];
    for (const [name, key, startId, endId, description] of phaseInfo) {
      if (durations[key] !== undefined) {
        const durationMs = durations[key];
        phases.push({
          name, description, durationMs,
          durationSec: durationMs / 1000,
          percentage: totalTime > 0 ? (durationMs / totalTime * 100) : 0,
          startEvent: startId, endEvent: endId,
        });
      }
    }

    let bottleneck: ProfilingPhase | null = null;
    const sortedPhases = [...phases].sort((a, b) => b.durationMs - a.durationMs);
    for (const phase of sortedPhases) {
      if (phase.name !== 'Running' && phase.percentage > 5) { bottleneck = phase; break; }
    }

    return { profilingMap, durations, phases, bottleneck, totalTimeMs: totalTime, totalTimeSec: totalTime / 1000 };
  }

  isRefreshSql(): boolean {
    return (this.plan.settings?.['cz.sql.text'] || '').toUpperCase().includes('REFRESH');
  }

  isApMode(): boolean {
    return (this.plan.settings?.['cz.inner.is.ap.vc'] || '0') === '1';
  }

  static getVcCores(settings: Record<string, string>): number {
    const isAp = (settings['cz.inner.is.ap.vc'] || '0') === '1';
    if (isAp) {
      return parseInt(settings['cz.analyze.instance.executor.count'] || '0', 10) || 0;
    }
    return Math.floor((parseInt(settings['cz.sql.gp.vc.capability'] || '0', 10) || 0) / 100);
  }
}
