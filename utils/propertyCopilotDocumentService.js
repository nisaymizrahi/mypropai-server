const { toFile } = require('openai');

const DocumentAsset = require('../models/DocumentAsset');
const PropertyCopilotIndex = require('../models/PropertyCopilotIndex');
const { buildAccessUrl } = require('./documentStorageService');

const SEARCHABLE_MIME_TYPES = new Set(['application/pdf']);
const VECTOR_STORE_EXPIRATION_DAYS = 14;

const toTimestamp = (value) => {
  const parsed = new Date(value || 0);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : '';
};

const isSearchableMimeType = (value) =>
  SEARCHABLE_MIME_TYPES.has(String(value || '').trim().toLowerCase());

const sanitizeFilename = (value, fallback = 'document.pdf') => {
  const normalized = String(value || '')
    .trim()
    .replace(/[^\w.\- ]+/g, '-')
    .replace(/\s+/g, ' ');

  if (!normalized) {
    return fallback;
  }

  return /\.pdf$/i.test(normalized) ? normalized : `${normalized}.pdf`;
};

const buildDocumentRecordKey = ({ sourceKind, sourceDocumentId }) =>
  `${sourceKind}:${sourceDocumentId}`;

const pickDocumentCategory = ({ sourceKind, document, asset }) => {
  if (sourceKind === 'project_document') {
    return document?.category || asset?.documentCategory || 'General';
  }

  if (document?.unit) {
    return 'Unit';
  }

  return asset?.documentCategory || 'Property';
};

const normalizeSearchableDocuments = async ({ projectDocuments = [], managedDocuments = [] }) => {
  const assetIds = [...new Set(
    [...projectDocuments, ...managedDocuments]
      .map((document) => String(document?.documentAsset || '').trim())
      .filter(Boolean)
  )];

  if (!assetIds.length) {
    return [];
  }

  const assets = await DocumentAsset.find({ _id: { $in: assetIds } }).lean();
  const assetMap = new Map(assets.map((asset) => [String(asset._id), asset]));

  return [
    ...projectDocuments.map((document) => ({ sourceKind: 'project_document', document })),
    ...managedDocuments.map((document) => ({ sourceKind: 'managed_document', document })),
  ]
    .map(({ sourceKind, document }) => {
      const asset = assetMap.get(String(document?.documentAsset || '')) || null;
      if (!asset || !isSearchableMimeType(asset.mimeType || document?.mimeType)) {
        return null;
      }

      const filename = sanitizeFilename(
        asset.originalFilename || document?.originalFilename || document?.displayName
      );

      return {
        key: buildDocumentRecordKey({
          sourceKind,
          sourceDocumentId: String(document._id),
        }),
        assetId: String(asset._id),
        sourceKind,
        sourceDocumentId: String(document._id),
        filename,
        displayName: document?.displayName || asset.displayName || filename,
        mimeType: asset.mimeType || document?.mimeType || 'application/pdf',
        category: pickDocumentCategory({ sourceKind, document, asset }),
        sourceUpdatedAt: document?.updatedAt || document?.createdAt || asset.updatedAt || asset.createdAt,
        asset,
      };
    })
    .filter(Boolean);
};

const ensureVectorStore = async ({ openai, indexRecord, propertyKey, propertyTitle }) => {
  const currentVectorStoreId = String(indexRecord?.vectorStoreId || '').trim();

  if (currentVectorStoreId) {
    try {
      const vectorStore = await openai.vectorStores.retrieve(currentVectorStoreId);
      if (vectorStore?.status !== 'expired') {
        return {
          vectorStoreId: vectorStore.id,
          vectorStoreStatus: vectorStore.status || 'completed',
          recreated: false,
        };
      }
    } catch (error) {
      // Fall through and recreate the vector store if the prior one is gone.
    }
  }

  const vectorStore = await openai.vectorStores.create({
    name: `${propertyTitle || 'Property'} documents`,
    metadata: {
      property_key: propertyKey,
    },
    expires_after: {
      anchor: 'last_active_at',
      days: VECTOR_STORE_EXPIRATION_DAYS,
    },
  });

  return {
    vectorStoreId: vectorStore.id,
    vectorStoreStatus: vectorStore.status || 'in_progress',
    recreated: true,
  };
};

const removeIndexedDocument = async ({ openai, vectorStoreId, indexedDocument }) => {
  if (indexedDocument?.vectorStoreFileId) {
    await openai.vectorStores.files
      .delete(indexedDocument.vectorStoreFileId, { vector_store_id: vectorStoreId })
      .catch(() => null);
  }

  if (indexedDocument?.openaiFileId) {
    await openai.files.delete(indexedDocument.openaiFileId).catch(() => null);
  }
};

const downloadAssetBuffer = async (asset) => {
  const accessUrl = buildAccessUrl(asset, { download: false });
  if (!accessUrl) {
    throw new Error('Could not generate a secure access URL for this document.');
  }

  const response = await fetch(accessUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${asset.displayName || asset.originalFilename || 'document'}.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

const syncPropertyDocumentIndex = async ({
  openai,
  userId,
  propertyKey,
  propertyId,
  propertyTitle,
  projectDocuments = [],
  managedDocuments = [],
}) => {
  const searchableDocuments = await normalizeSearchableDocuments({
    projectDocuments,
    managedDocuments,
  });

  let indexRecord =
    (await PropertyCopilotIndex.findOne({ user: userId, propertyKey })) ||
    new PropertyCopilotIndex({
      user: userId,
      propertyKey,
      propertyId: propertyId || null,
    });

  if (!searchableDocuments.length) {
    if (indexRecord.vectorStoreId) {
      await openai.vectorStores.delete(indexRecord.vectorStoreId).catch(() => null);
    }

    indexRecord.propertyId = propertyId || indexRecord.propertyId || null;
    indexRecord.vectorStoreId = '';
    indexRecord.vectorStoreStatus = '';
    indexRecord.lastSyncedAt = new Date();
    indexRecord.lastSyncError = '';
    indexRecord.indexedDocuments = [];
    await indexRecord.save();
    return {
      indexRecord,
      searchableDocumentCount: 0,
      indexedDocumentCount: 0,
      searchableDocuments,
    };
  }

  const vectorStoreState = await ensureVectorStore({
    openai,
    indexRecord,
    propertyKey,
    propertyTitle,
  });

  indexRecord.vectorStoreId = vectorStoreState.vectorStoreId;
  indexRecord.vectorStoreStatus = vectorStoreState.vectorStoreStatus;
  indexRecord.propertyId = propertyId || indexRecord.propertyId || null;

  const searchableMap = new Map(searchableDocuments.map((document) => [document.key, document]));
  const nextIndexedDocuments = vectorStoreState.recreated ? [] : [];

  for (const indexedDocument of vectorStoreState.recreated ? [] : indexRecord.indexedDocuments || []) {
    const currentDocument = searchableMap.get(
      buildDocumentRecordKey({
        sourceKind: indexedDocument.sourceKind,
        sourceDocumentId: indexedDocument.sourceDocumentId,
      })
    );

    if (!currentDocument) {
      await removeIndexedDocument({
        openai,
        vectorStoreId: indexRecord.vectorStoreId,
        indexedDocument,
      });
      continue;
    }

    if (
      indexedDocument.status !== 'indexed' ||
      !indexedDocument.vectorStoreFileId ||
      !indexedDocument.openaiFileId
    ) {
      await removeIndexedDocument({
        openai,
        vectorStoreId: indexRecord.vectorStoreId,
        indexedDocument,
      });
      continue;
    }

    if (toTimestamp(indexedDocument.sourceUpdatedAt) !== toTimestamp(currentDocument.sourceUpdatedAt)) {
      await removeIndexedDocument({
        openai,
        vectorStoreId: indexRecord.vectorStoreId,
        indexedDocument,
      });
      continue;
    }

    nextIndexedDocuments.push(indexedDocument);
  }

  const indexedByKey = new Map(
    nextIndexedDocuments.map((document) => [
      buildDocumentRecordKey({
        sourceKind: document.sourceKind,
        sourceDocumentId: document.sourceDocumentId,
      }),
      document,
    ])
  );

  for (const document of searchableDocuments) {
    if (indexedByKey.has(document.key)) {
      continue;
    }

    try {
      const buffer = await downloadAssetBuffer(document.asset);
      const openaiFile = await openai.files.create({
        file: await toFile(buffer, document.filename),
        purpose: 'assistants',
      });

      const vectorStoreFile = await openai.vectorStores.files.createAndPoll(
        indexRecord.vectorStoreId,
        {
          file_id: openaiFile.id,
          attributes: {
            property_key: propertyKey,
            asset_id: document.assetId,
            category: document.category,
            source_kind: document.sourceKind,
            source_document_id: document.sourceDocumentId,
            source_updated_at: Math.floor(
              new Date(document.sourceUpdatedAt || Date.now()).getTime() / 1000
            ),
          },
        },
        { pollIntervalMs: 1000 }
      );

      nextIndexedDocuments.push({
        assetId: document.assetId,
        sourceKind: document.sourceKind,
        sourceDocumentId: document.sourceDocumentId,
        openaiFileId: openaiFile.id,
        vectorStoreFileId: vectorStoreFile.id,
        filename: document.filename,
        mimeType: document.mimeType,
        category: document.category,
        sourceUpdatedAt: document.sourceUpdatedAt,
        indexedAt: new Date(),
        status: vectorStoreFile.status === 'completed' ? 'indexed' : 'failed',
        lastError: vectorStoreFile.last_error?.message || '',
      });
    } catch (error) {
      nextIndexedDocuments.push({
        assetId: document.assetId,
        sourceKind: document.sourceKind,
        sourceDocumentId: document.sourceDocumentId,
        openaiFileId: '',
        vectorStoreFileId: '',
        filename: document.filename,
        mimeType: document.mimeType,
        category: document.category,
        sourceUpdatedAt: document.sourceUpdatedAt,
        indexedAt: new Date(),
        status: 'failed',
        lastError: error.message || 'Failed to index this document.',
      });
    }
  }

  indexRecord.indexedDocuments = nextIndexedDocuments;
  indexRecord.vectorStoreStatus = nextIndexedDocuments.some((document) => document.status === 'indexed')
    ? 'completed'
    : indexRecord.vectorStoreStatus || 'in_progress';
  indexRecord.lastSyncedAt = new Date();
  indexRecord.lastSyncError =
    nextIndexedDocuments.find((document) => document.status === 'failed')?.lastError || '';
  await indexRecord.save();

  return {
    indexRecord,
    searchableDocumentCount: searchableDocuments.length,
    indexedDocumentCount: nextIndexedDocuments.filter((document) => document.status === 'indexed').length,
    searchableDocuments,
  };
};

const searchPropertyDocuments = async ({
  openai,
  userId,
  propertyKey,
  propertyId,
  propertyTitle,
  projectDocuments = [],
  managedDocuments = [],
  query,
}) => {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    return {
      ok: false,
      message: 'Please provide a document question to search for.',
      results: [],
    };
  }

  const syncResult = await syncPropertyDocumentIndex({
    openai,
    userId,
    propertyKey,
    propertyId,
    propertyTitle,
    projectDocuments,
    managedDocuments,
  });

  const readyIndexedDocuments = (syncResult.indexRecord.indexedDocuments || []).filter(
    (document) => document.status === 'indexed' && document.vectorStoreFileId
  );
  const failedIndexedDocuments = (syncResult.indexRecord.indexedDocuments || []).filter(
    (document) => document.status === 'failed'
  );

  if (!syncResult.searchableDocumentCount) {
    return {
      ok: false,
      message:
        'No searchable PDFs are uploaded for this property yet. Upload a PDF in Documents and ask again.',
      results: [],
    };
  }

  if (!readyIndexedDocuments.length || !syncResult.indexRecord.vectorStoreId) {
    if (
      failedIndexedDocuments.length &&
      failedIndexedDocuments.length >= syncResult.searchableDocumentCount
    ) {
      return {
        ok: false,
        message:
          'I found uploaded PDFs for this property, but they could not be prepared for search yet. Re-uploading text-based PDFs usually fixes that.',
        results: [],
      };
    }

    return {
      ok: false,
      message:
        'The property documents are still being prepared for search. Try again in a moment.',
      results: [],
    };
  }

  const resultsPage = await openai.vectorStores.search(syncResult.indexRecord.vectorStoreId, {
    query: normalizedQuery,
    max_num_results: 6,
    rewrite_query: true,
    ranking_options: {
      ranker: 'auto',
      score_threshold: 0.15,
    },
  });

  const results = (resultsPage.data || [])
    .map((result) => ({
      filename: result.filename || 'Document',
      score: result.score ?? null,
      text: Array.isArray(result.content)
        ? result.content
            .map((item) => item?.text || '')
            .filter(Boolean)
            .join('\n')
            .trim()
        : '',
      assetId: String(result.attributes?.asset_id || '').trim(),
      category: String(result.attributes?.category || '').trim(),
      sourceKind: String(result.attributes?.source_kind || '').trim(),
    }))
    .filter((result) => result.text);

  if (!results.length) {
    return {
      ok: false,
      message:
        'I searched the uploaded property documents but did not find a strong match for that question.',
      results: [],
    };
  }

  return {
    ok: true,
    message: `Found ${results.length} relevant document excerpt${results.length === 1 ? '' : 's'}.`,
    results,
  };
};

module.exports = {
  SEARCHABLE_MIME_TYPES,
  normalizeSearchableDocuments,
  searchPropertyDocuments,
  syncPropertyDocumentIndex,
};
