pub fn random_hex(byte_count: usize) -> String {
    let mut bytes = vec![0u8; byte_count];
    getrandom::fill(&mut bytes).expect("the operating system random number generator is available");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_two_hex_characters_per_byte() {
        let value = random_hex(16);
        assert_eq!(value.len(), 32);
        assert!(value.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn returns_a_different_value_each_time() {
        assert_ne!(random_hex(32), random_hex(32));
    }
}
