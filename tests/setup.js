import nodeFetch from 'node-fetch'
// Mocking fetch Web API using node-fetch
if (typeof fetch === 'undefined') {
    global.fetch = nodeFetch
    global.Request = nodeFetch.Request
}
