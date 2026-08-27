/**
 * GeoPlan Android GIS - IndexedDB Offline Storage Layer
 * Manages persistent local data for Projects, PDF Plans, Vector Features, and Photos.
 */

class StorageDB {
  constructor() {
    this.dbName = 'GeoPlanFieldDB';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Projects Store
        if (!db.objectStoreNames.contains('projects')) {
          const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
          projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // PDF Plans Store
        if (!db.objectStoreNames.contains('pdf_plans')) {
          const planStore = db.createObjectStore('pdf_plans', { keyPath: 'id' });
          planStore.createIndex('projectId', 'projectId', { unique: false });
        }

        // Vector Features Store (Points, Lines, Polygons)
        if (!db.objectStoreNames.contains('features')) {
          const featureStore = db.createObjectStore('features', { keyPath: 'id' });
          featureStore.createIndex('projectId', 'projectId', { unique: false });
          featureStore.createIndex('type', 'type', { unique: false });
        }

        // App Settings Store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('Error opening IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  // Generic transaction helper
  async _tx(storeName, mode, callback) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;

      try {
        result = callback(store);
      } catch (err) {
        reject(err);
        return;
      }

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /* ==========================================================================
     Projects Operations
     ========================================================================== */
  async getAllProjects() {
    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('projects', 'readonly');
      const store = tx.objectStore('projects');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getProject(id) {
    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('projects', 'readonly');
      const store = tx.objectStore('projects');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveProject(project) {
    project.updatedAt = Date.now();
    if (!project.createdAt) project.createdAt = Date.now();
    if (!project.id) project.id = 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('projects', 'readwrite');
      const store = tx.objectStore('projects');
      const req = store.put(project);
      req.onsuccess = () => resolve(project);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteProject(projectId) {
    await this.init();
    // Delete project and all associated features & plans
    const tx = this.db.transaction(['projects', 'pdf_plans', 'features'], 'readwrite');
    
    // Delete project
    tx.objectStore('projects').delete(projectId);

    // Delete PDF plans
    const planStore = tx.objectStore('pdf_plans');
    const planIdx = planStore.index('projectId');
    const planReq = planIdx.getAllKeys(projectId);
    planReq.onsuccess = () => {
      (planReq.result || []).forEach(key => planStore.delete(key));
    };

    // Delete Features
    const featStore = tx.objectStore('features');
    const featIdx = featStore.index('projectId');
    const featReq = featIdx.getAllKeys(projectId);
    featReq.onsuccess = () => {
      (featReq.result || []).forEach(key => featStore.delete(key));
    };

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ==========================================================================
     PDF Plans Operations
     ========================================================================== */
  async getPdfPlansByProject(projectId) {
    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('pdf_plans', 'readonly');
      const store = tx.objectStore('pdf_plans');
      const index = store.index('projectId');
      const req = index.getAll(projectId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getPdfPlan(id) {
    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('pdf_plans', 'readonly');
      const store = tx.objectStore('pdf_plans');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async savePdfPlan(plan) {
    plan.updatedAt = Date.now();
    if (!plan.id) plan.id = 'plan_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('pdf_plans', 'readwrite');
      const store = tx.objectStore('pdf_plans');
      const req = store.put(plan);
      req.onsuccess = () => resolve(plan);
      req.onerror = () => reject(req.error);
    });
  }

  async deletePdfPlan(planId) {
    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('pdf_plans', 'readwrite');
      const store = tx.objectStore('pdf_plans');
      const req = store.delete(planId);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /* ==========================================================================
     Vector Features Operations (Points, Lines, Polygons)
     ========================================================================== */
  async getFeaturesByProject(projectId) {
    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('features', 'readonly');
      const store = tx.objectStore('features');
      const index = store.index('projectId');
      const req = index.getAll(projectId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getFeature(id) {
    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('features', 'readonly');
      const store = tx.objectStore('features');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveFeature(feature) {
    feature.updatedAt = Date.now();
    if (!feature.createdAt) feature.createdAt = Date.now();
    if (!feature.id) feature.id = 'feat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('features', 'readwrite');
      const store = tx.objectStore('features');
      const req = store.put(feature);
      req.onsuccess = () => resolve(feature);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteFeature(id) {
    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('features', 'readwrite');
      const store = tx.objectStore('features');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /* ==========================================================================
     Settings & Active State Operations
     ========================================================================== */
  async getSetting(key, defaultValue = null) {
    return new Promise(async (resolve) => {
      try {
        await this.init();
        const tx = this.db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
        req.onerror = () => resolve(defaultValue);
      } catch (e) {
        resolve(defaultValue);
      }
    });
  }

  async setSetting(key, value) {
    return new Promise(async (resolve, reject) => {
      await this.init();
      const tx = this.db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const req = store.put({ key, value });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
}

// Global Singleton Instance
window.db = new StorageDB();
