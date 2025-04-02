// Test script to verify HTTP method handling in the proxy server
const axios = require('axios');

// Test creating a mock with PUT method
async function testCreatePutMock() {
    try {
        console.log('Testing creation of PUT mock...');
        
        const mockData = {
            method: 'PUT',
            path: '/test-put-endpoint',
            statusCode: 200,
            responseBody: { message: 'This is a PUT mock' },
            enabled: true
        };
        
        const response = await axios.post('http://localhost:3333/mocks', mockData);
        
        console.log('Response status:', response.status);
        console.log('Response data:', response.data);
        
        if (response.data.success) {
            console.log('✅ Mock created successfully');
            console.log(`Saved method: ${response.data.mock.method}`);
            
            // Verify the method is correct
            if (response.data.mock.method === 'PUT') {
                console.log('✅ Method was preserved correctly!');
            } else {
                console.log(`❌ Method mismatch! Expected PUT but got ${response.data.mock.method}`);
            }
            
            return response.data.mock.id;
        } else {
            console.log('❌ Failed to create mock');
            return null;
        }
    } catch (error) {
        console.error('Error creating mock:', error.message);
        return null;
    }
}

// Test retrieving all mocks to verify the method
async function testGetMocks(mockId) {
    try {
        console.log('\nRetrieving all mocks to verify method...');
        
        const response = await axios.get('http://localhost:3333/mocks');
        
        if (response.data.success) {
            console.log('✅ Retrieved mocks successfully');
            
            // Find our test mock
            const testMock = response.data.mocks.find(mock => mock.id === mockId);
            
            if (testMock) {
                console.log('Found our test mock');
                console.log('Method:', testMock.method);
                
                // Verify the method is correct
                if (testMock.method === 'PUT') {
                    console.log('✅ Method was preserved correctly in storage!');
                } else {
                    console.log(`❌ Method mismatch in storage! Expected PUT but got ${testMock.method}`);
                }
            } else {
                console.log('❌ Could not find the test mock');
            }
        } else {
            console.log('❌ Failed to retrieve mocks');
        }
    } catch (error) {
        console.error('Error retrieving mocks:', error.message);
    }
}

// Test updating a mock to change its method
async function testUpdateMockMethod(mockId) {
    if (!mockId) {
        console.log('❌ Cannot update mock: No mock ID provided');
        return;
    }
    
    try {
        console.log('\nTesting update of mock method...');
        
        const mockData = {
            method: 'PATCH', // Change from PUT to PATCH
            path: '/test-put-endpoint',
            statusCode: 200,
            responseBody: { message: 'This is now a PATCH mock' },
            enabled: true
        };
        
        const response = await axios.put(`http://localhost:3333/mocks/${mockId}`, mockData);
        
        console.log('Response status:', response.status);
        console.log('Response data:', response.data);
        
        if (response.data.success) {
            console.log('✅ Mock updated successfully');
            console.log(`Updated method: ${response.data.mock.method}`);
            
            // Verify the method is correct
            if (response.data.mock.method === 'PATCH') {
                console.log('✅ Method was updated correctly!');
            } else {
                console.log(`❌ Method update failed! Expected PATCH but got ${response.data.mock.method}`);
            }
        } else {
            console.log('❌ Failed to update mock');
        }
    } catch (error) {
        console.error('Error updating mock:', error.message);
    }
}

// Run the tests
async function runTests() {
    // Create a mock with PUT method
    const mockId = await testCreatePutMock();
    
    // Get all mocks to verify the method
    await testGetMocks(mockId);
    
    // Update the mock to change its method
    await testUpdateMockMethod(mockId);
    
    // Get all mocks again to verify the updated method
    await testGetMocks(mockId);
    
    console.log('\nTests completed!');
}

// Run the tests
runTests(); 