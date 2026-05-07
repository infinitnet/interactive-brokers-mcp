// test/flex-query-client.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FlexQueryClient } from '../src/flex-query-client.js';
import axios from 'axios';

// Mock axios
vi.mock('axios');

describe('FlexQueryClient', () => {
  let client: FlexQueryClient;
  const mockToken = 'test-token-123';
  const mockQueryId = '123456';
  const mockReferenceCode = 'ref-code-789';

  beforeEach(() => {
    vi.clearAllMocks();
    client = new FlexQueryClient({ token: mockToken });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with token', () => {
      expect(client).toBeDefined();
    });

    it('should create axios client with timeout', () => {
      expect(axios.create).toHaveBeenCalledWith({
        timeout: 60000,
      });
    });
  });

  describe('sendRequest', () => {
    it('should successfully send request and return reference code', async () => {
      const mockResponse = {
        data: `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 01:59 PM EDT">
  <Status>Success</Status>
  <ReferenceCode>${mockReferenceCode}</ReferenceCode>
  <Url>https://example.com/statement</Url>
</FlexStatementResponse>`,
      };

      const mockGet = vi.fn().mockResolvedValue(mockResponse);
      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.sendRequest(mockQueryId);

      expect(mockGet).toHaveBeenCalledWith(
        'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest',
        {
          params: {
            t: mockToken,
            q: mockQueryId,
            v: '3',
          },
        }
      );

      expect(result).toEqual({
        referenceCode: mockReferenceCode,
        url: 'https://example.com/statement',
      });
    });

    it('should return error on failed request', async () => {
      const mockResponse = {
        data: `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 01:59 PM EDT">
  <Status>Fail</Status>
  <ErrorCode>1001</ErrorCode>
  <ErrorMessage>Invalid token</ErrorMessage>
</FlexStatementResponse>`,
      };

      const mockGet = vi.fn().mockResolvedValue(mockResponse);
      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.sendRequest(mockQueryId);

      expect(result).toEqual({
        error: 'Invalid token',
        errorCode: '1001',
      });
    });

    it('should handle network errors', async () => {
      const mockError = new Error('Network error');
      Object.defineProperty(mockError, 'isAxiosError', { value: true });
      
      const mockGet = vi.fn().mockRejectedValue(mockError);
      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      // Check the axios.isAxiosError before the test
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(client.sendRequest(mockQueryId)).rejects.toThrow(
        'Failed to send flex query request: Network error'
      );
    });

    it('should handle unexpected response format', async () => {
      const mockResponse = {
        data: `<?xml version="1.0" encoding="UTF-8"?>
<UnexpectedFormat>
  <Data>Something</Data>
</UnexpectedFormat>`,
      };

      const mockGet = vi.fn().mockResolvedValue(mockResponse);
      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      await expect(client.sendRequest(mockQueryId)).rejects.toThrow(
        'Unexpected response format from Flex Query service'
      );
    });
  });

  describe('getStatement', () => {
    it('should successfully get statement data', async () => {
      const mockStatementData = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test Query" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U12345" fromDate="2023-01-01" toDate="2023-12-31">
      <AccountInformation>
        <EquitySummaryByReportDateInBase accountId="U12345" acctAlias="Test" />
      </AccountInformation>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

      const mockResponse = {
        data: mockStatementData,
      };

      const mockGet = vi.fn().mockResolvedValue(mockResponse);
      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.getStatement(mockReferenceCode);

      expect(mockGet).toHaveBeenCalledWith(
        'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement',
        {
          params: {
            t: mockToken,
            q: mockReferenceCode,
            v: '3',
          },
        }
      );

      expect(result).toEqual({
        data: mockStatementData,
      });
    });

    it('should return error when statement not ready', async () => {
      const mockResponse = {
        data: `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 02:00 PM EDT">
  <Status>Fail</Status>
  <ErrorCode>1019</ErrorCode>
  <ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage>
</FlexStatementResponse>`,
      };

      const mockGet = vi.fn().mockResolvedValue(mockResponse);
      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.getStatement(mockReferenceCode);

      expect(result).toEqual({
        error: 'Statement generation in progress. Please try again shortly.',
        errorCode: '1019',
      });
    });

    it('should handle network errors', async () => {
      const mockError = new Error('Network timeout');
      Object.defineProperty(mockError, 'isAxiosError', { value: true });
      
      const mockGet = vi.fn().mockRejectedValue(mockError);
      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(client.getStatement(mockReferenceCode)).rejects.toThrow(
        'Failed to get flex statement: Network timeout'
      );
    });
  });

  describe('executeQuery', () => {
    it('should execute query and wait for statement', async () => {
      const sendResponseXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 01:59 PM EDT">
  <Status>Success</Status>
  <ReferenceCode>${mockReferenceCode}</ReferenceCode>
  <Url>https://example.com/statement</Url>
</FlexStatementResponse>`;

      const statementXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test Query" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U12345" fromDate="2023-01-01" toDate="2023-12-31">
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

      const mockGet = vi.fn()
        .mockResolvedValueOnce({ data: sendResponseXml })
        .mockResolvedValueOnce({ data: statementXml });

      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.executeQuery(mockQueryId, 3, 100);

      expect(result).toEqual({
        data: statementXml,
      });
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('should retry when statement is not ready', async () => {
      const sendResponseXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 01:59 PM EDT">
  <Status>Success</Status>
  <ReferenceCode>${mockReferenceCode}</ReferenceCode>
</FlexStatementResponse>`;

      const notReadyXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 02:00 PM EDT">
  <Status>Fail</Status>
  <ErrorCode>1019</ErrorCode>
  <ErrorMessage>Statement generation in progress</ErrorMessage>
</FlexStatementResponse>`;

      const statementXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test Query" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U12345" />
  </FlexStatements>
</FlexQueryResponse>`;

      const mockGet = vi.fn()
        .mockResolvedValueOnce({ data: sendResponseXml })
        .mockResolvedValueOnce({ data: notReadyXml })
        .mockResolvedValueOnce({ data: statementXml });

      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.executeQuery(mockQueryId, 3, 100);

      expect(result).toEqual({
        data: statementXml,
      });
      expect(mockGet).toHaveBeenCalledTimes(3);
    });

    it.each([
      ['1001', 'Statement could not be generated at this time. Please try again shortly.'],
      ['1009', 'The server is under heavy load and statement could not be generated at this time. Please try again shortly.'],
      ['1019', 'Statement generation in progress. Please try again shortly.'],
      ['1021', 'Statement could not be retrieved at this time. Please try again shortly.'],
    ])('should retry on transient GetStatement error code %s', async (code, message) => {
      const sendResponseXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 01:59 PM EDT">
  <Status>Success</Status>
  <ReferenceCode>${mockReferenceCode}</ReferenceCode>
</FlexStatementResponse>`;

      const transientXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 02:00 PM EDT">
  <Status>Fail</Status>
  <ErrorCode>${code}</ErrorCode>
  <ErrorMessage>${message}</ErrorMessage>
</FlexStatementResponse>`;

      const statementXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test Query" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U12345" />
  </FlexStatements>
</FlexQueryResponse>`;

      const mockGet = vi.fn()
        .mockResolvedValueOnce({ data: sendResponseXml })
        .mockResolvedValueOnce({ data: transientXml })
        .mockResolvedValueOnce({ data: statementXml });

      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.executeQuery(mockQueryId, 3, 10);

      expect(result).toEqual({ data: statementXml });
      expect(mockGet).toHaveBeenCalledTimes(3);
    });

    it('should not retry on terminal GetStatement errors (e.g. 1015 invalid token)', async () => {
      const sendResponseXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 01:59 PM EDT">
  <Status>Success</Status>
  <ReferenceCode>${mockReferenceCode}</ReferenceCode>
</FlexStatementResponse>`;

      const terminalXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 02:00 PM EDT">
  <Status>Fail</Status>
  <ErrorCode>1015</ErrorCode>
  <ErrorMessage>Token is invalid.</ErrorMessage>
</FlexStatementResponse>`;

      const mockGet = vi.fn()
        .mockResolvedValueOnce({ data: sendResponseXml })
        .mockResolvedValueOnce({ data: terminalXml });

      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.executeQuery(mockQueryId, 5, 10);

      expect(result).toEqual({
        error: 'Token is invalid.',
        errorCode: '1015',
      });
      // Should bail after the first GetStatement attempt — no further retries
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('should retry when fallback transient message casing differs', async () => {
      const sendResponseXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 01:59 PM EDT">
  <Status>Success</Status>
  <ReferenceCode>${mockReferenceCode}</ReferenceCode>
</FlexStatementResponse>`;

      const transientXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 02:00 PM EDT">
  <Status>Fail</Status>
  <ErrorCode>9999</ErrorCode>
  <ErrorMessage>Statement could not be retrieved. Try Again Shortly.</ErrorMessage>
</FlexStatementResponse>`;

      const statementXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test Query" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U12345" />
  </FlexStatements>
</FlexQueryResponse>`;

      const mockGet = vi.fn()
        .mockResolvedValueOnce({ data: sendResponseXml })
        .mockResolvedValueOnce({ data: transientXml })
        .mockResolvedValueOnce({ data: statementXml });

      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.executeQuery(mockQueryId, 3, 10);

      expect(result).toEqual({ data: statementXml });
      expect(mockGet).toHaveBeenCalledTimes(3);
    });

    it('should return error when sendRequest fails', async () => {
      const sendResponseXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 01:59 PM EDT">
  <Status>Fail</Status>
  <ErrorCode>1001</ErrorCode>
  <ErrorMessage>Invalid query ID</ErrorMessage>
</FlexStatementResponse>`;

      const mockGet = vi.fn().mockResolvedValueOnce({ data: sendResponseXml });
      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.executeQuery(mockQueryId);

      expect(result).toEqual({
        error: 'Invalid query ID',
        errorCode: '1001',
      });
    });

    it('should timeout after max retries', async () => {
      const sendResponseXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 01:59 PM EDT">
  <Status>Success</Status>
  <ReferenceCode>${mockReferenceCode}</ReferenceCode>
</FlexStatementResponse>`;

      const notReadyXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 02:00 PM EDT">
  <Status>Fail</Status>
  <ErrorCode>1019</ErrorCode>
  <ErrorMessage>Statement generation in progress</ErrorMessage>
</FlexStatementResponse>`;

      const mockGet = vi.fn()
        .mockResolvedValueOnce({ data: sendResponseXml })
        .mockResolvedValue({ data: notReadyXml }); // Always return not ready

      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.executeQuery(mockQueryId, 2, 100);

      expect(result).toEqual({
        error: 'Statement not ready after 2 retries. Please try again later.',
      });
    });

    it('should return error when no reference code received', async () => {
      const sendResponseXml = `<?xml version="1.0" encoding="UTF-8"?>
<FlexStatementResponse timestamp="26 August, 2023 01:59 PM EDT">
  <Status>Success</Status>
</FlexStatementResponse>`;

      const mockGet = vi.fn().mockResolvedValueOnce({ data: sendResponseXml });
      (axios.create as any).mockReturnValue({ get: mockGet });
      client = new FlexQueryClient({ token: mockToken });

      const result = await client.executeQuery(mockQueryId);

      expect(result).toEqual({
        error: 'No reference code received from flex query service',
      });
    });
  });

  describe('parseStatement', () => {
    it('should parse XML statement into JSON', async () => {
      const xmlData = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test Query" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U12345" fromDate="2023-01-01" toDate="2023-12-31">
      <AccountInformation currency="USD" />
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

      const result = await client.parseStatement(xmlData);

      expect(result).toBeDefined();
      expect(result.FlexQueryResponse).toBeDefined();
      expect(result.FlexQueryResponse.queryName).toBe('Test Query');
      expect(result.FlexQueryResponse.type).toBe('AF');
    });

    it('should handle parsing errors', async () => {
      const invalidXml = 'This is not valid XML';

      await expect(client.parseStatement(invalidXml)).rejects.toThrow(
        'Failed to parse flex statement XML'
      );
    });

    it('should parse XML with mergeAttrs option', async () => {
      const xmlData = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Test" type="AF">
  <Data value="123" />
</FlexQueryResponse>`;

      const result = await client.parseStatement(xmlData);

      // mergeAttrs should merge attributes into the object
      expect(result.FlexQueryResponse.Data.value).toBe('123');
    });
  });
});
