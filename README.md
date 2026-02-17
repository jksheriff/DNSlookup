socket.gethostbyname()

This function:

Takes a domain name (like google.com)

Sends a DNS request

Returns the IP address


ip_address = socket.gethostbyname(domain)

1 Python looks inside the socket module.

2 It finds the function gethostbyname.

3 It calls that function and passes the value stored in domain.

4 The function performs a DNS lookup.

5 The function returns a string containing the IP address.

6 That returned string gets assigned to the variable ip_address.